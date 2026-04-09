import sys
import os
import io
import zipfile
import glob
import re
import cv2
import numpy as np
from PIL import Image

def get_inbox_files():
    files = glob.glob("inbox/*")
    original = next((f for f in files if 'original' in f.lower()), None)
    generated = next((f for f in files if 'generated' in f.lower()), None)
    return original, generated

def remove_bg():
    from rembg import remove
    print("JOB 1: Removing background from original scene...")
    os.makedirs("workspace", exist_ok=True)
    orig_path, _ = get_inbox_files()
    
    orig_pil = Image.open(orig_path).convert("RGB")
    nobg_pil = remove(orig_pil)
    
    # Save the isolated subject mask to pass to Job 4
    mask = np.array(nobg_pil)[:, :, 3]
    Image.fromarray(mask).save("workspace/subject_mask.png")
    print("Background removed. Mask saved to workspace.")

def align():
    print("JOB 2: Aligning generated hallucination to original source...")
    os.makedirs("workspace", exist_ok=True)
    orig_path, gen_path = get_inbox_files()
    
    orig_cv = cv2.imread(orig_path)
    gen_cv = cv2.imread(gen_path)
    
    gen_cv = cv2.resize(gen_cv, (orig_cv.shape[1], orig_cv.shape[0]))
    
    gray_src = cv2.cvtColor(orig_cv, cv2.COLOR_BGR2GRAY)
    gray_tgt = cv2.cvtColor(gen_cv, cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(MAX_FEATURES=5000)
    kp_src, des_src = orb.detectAndCompute(gray_src, None)
    kp_tgt, des_tgt = orb.detectAndCompute(gray_tgt, None)

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    matches = bf.knnMatch(des_src, des_tgt, k=2)

    good_matches = [m for m, n in matches if m.distance < 0.75 * n.distance]

    if len(good_matches) > 10:
        src_pts = np.float32([kp_src[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
        tgt_pts = np.float32([kp_tgt[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
        matrix, _ = cv2.findHomography(tgt_pts, src_pts, cv2.RANSAC, 5.0)
        
        if matrix is not None:
            aligned = cv2.warpPerspective(gen_cv, matrix, (orig_cv.shape[1], orig_cv.shape[0]))
        else:
            aligned = gen_cv
    else:
        aligned = gen_cv

    cv2.imwrite("workspace/aligned_generated.png", aligned)
    print("Alignment complete. Result saved to workspace.")

def get_depth():
    import torch
    from transformers import pipeline
    print("JOB 3: Extracting depth map from generated image...")
    os.makedirs("workspace", exist_ok=True)
    
    device = 0 if torch.cuda.is_available() else -1
    depth_pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device)
    
    aligned_pil = Image.open("workspace/aligned_generated.png").convert("RGB")
    depth_result = depth_pipe(aligned_pil)
    
    # Save as high-precision numpy array to preserve exact floating point depth for slicing
    depth_array = np.array(depth_result["depth"]).astype(np.float32)
    np.save("workspace/raw_depth.npy", depth_array)
    print("Depth hallucinated. Array saved to workspace.")

def segment():
    print("JOB 4: Segmenting original image into layers...")
    orig_path, _ = get_inbox_files()
    match = re.search(r'_layers-(\d+)\.', orig_path)
    layers = int(match.group(1)) if match else 6

    orig_array = np.array(Image.open(orig_path).convert("RGB"))
    mask_array = np.array(Image.open("workspace/subject_mask.png")) > 0
    depth_array = np.load("workspace/raw_depth.npy")

    subject_depth = depth_array[mask_array]
    min_depth, max_depth = subject_depth.min(), subject_depth.max()
    
    normalized_depth = np.zeros_like(depth_array)
    normalized_depth[mask_array] = np.interp(depth_array[mask_array], (min_depth, max_depth), (0, 255))

    bins = np.linspace(0, 255.1, layers + 1)
    
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        for i in range(layers):
            layer_mask = (normalized_depth >= bins[i]) & (normalized_depth < bins[i+1]) & mask_array
            
            if np.any(layer_mask):
                layer_rgba = np.zeros((orig_array.shape[0], orig_array.shape[1], 4), dtype=np.uint8)
                layer_rgba[..., :3] = orig_array
                mask_smoothed = cv2.GaussianBlur((layer_mask * 255).astype(np.uint8), (5, 5), 0)
                layer_rgba[..., 3] = mask_smoothed
                
                img_byte_arr = io.BytesIO()
                Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
                zip_file.writestr(f"layer_{i:03d}.png", img_byte_arr.getvalue())
                
    print("Segmentation complete. Artifact packaged.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Specify a job: remove_bg, align, depth, segment")
        sys.exit(1)
        
    job = sys.argv[1]
    if job == "remove_bg": remove_bg()
    elif job == "align": align()
    elif job == "depth": get_depth()
    elif job == "segment": segment()
