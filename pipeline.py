import sys
import os
import io
import zipfile
import glob
import re
import cv2
import numpy as np
from PIL import Image

def get_input_file():
    files = glob.glob("inbox/*")
    return next((f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg'))), None)

def remove_background():
    from rembg import remove
    print("Step 1: Removing background...")
    os.makedirs("workspace", exist_ok=True)
    file_path = get_input_file()
    
    if not file_path:
        print("Error: No valid image found in inbox.")
        sys.exit(1)
        
    image = Image.open(file_path).convert("RGB")
    image_nobg = remove(image)
    
    mask = np.array(image_nobg)[:, :, 3]
    Image.fromarray(mask).save("workspace/subject_mask.png")
    print("Background removed. Mask saved.")

def generate_image():
    import torch
    from diffusers import StableDiffusionImg2ImgPipeline
    print("Step 2: Generating structural image...")
    os.makedirs("workspace", exist_ok=True)
    file_path = get_input_file()
    
    init_image = Image.open(file_path).convert("RGB")
    
    pipe = StableDiffusionImg2ImgPipeline.from_pretrained("runwayml/stable-diffusion-v1-5", torch_dtype=torch.float32)
    pipe.safety_checker = None
    
    prompt = "A high fidelity 3D render, volumetric depth, clear geometry, structural, high contrast"
    generated = pipe(prompt=prompt, image=init_image, strength=0.65, guidance_scale=7.5).images[0]
    
    generated.save("workspace/generated_image.png")
    print("Image generation complete.")

def align_images():
    print("Step 3: Aligning generated image to source...")
    os.makedirs("workspace", exist_ok=True)
    file_path = get_input_file()
    
    source_cv = cv2.imread(file_path)
    gen_cv = cv2.imread("workspace/generated_image.png")
    
    gen_cv = cv2.resize(gen_cv, (source_cv.shape[1], source_cv.shape[0]))
    
    gray_src = cv2.cvtColor(source_cv, cv2.COLOR_BGR2GRAY)
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
            aligned = cv2.warpPerspective(gen_cv, matrix, (source_cv.shape[1], source_cv.shape[0]))
        else:
            aligned = gen_cv
    else:
        aligned = gen_cv

    cv2.imwrite("workspace/aligned_image.png", aligned)
    print("Alignment complete.")

def extract_depth():
    import torch
    from transformers import pipeline
    print("Step 4: Extracting depth map...")
    os.makedirs("workspace", exist_ok=True)
    
    device = 0 if torch.cuda.is_available() else -1
    depth_pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device)
    
    aligned_pil = Image.open("workspace/aligned_image.png").convert("RGB")
    depth_result = depth_pipe(aligned_pil)
    
    depth_array = np.array(depth_result["depth"]).astype(np.float32)
    np.save("workspace/depth_map.npy", depth_array)
    print("Depth map extracted and saved.")

def segment_layers():
    print("Step 5: Segmenting image into layers...")
    file_path = get_input_file()
    match = re.search(r'_layers-(\d+)\.', file_path)
    layers = int(match.group(1)) if match else 6

    source_array = np.array(Image.open(file_path).convert("RGB"))
    mask_array = np.array(Image.open("workspace/subject_mask.png")) > 0
    depth_array = np.load("workspace/depth_map.npy")

    subject_depth = depth_array[mask_array]
    if len(subject_depth) == 0:
        print("Error: Subject mask is empty.")
        return

    min_depth, max_depth = subject_depth.min(), subject_depth.max()
    normalized_depth = np.zeros_like(depth_array)
    normalized_depth[mask_array] = np.interp(depth_array[mask_array], (min_depth, max_depth), (0, 255))

    bins = np.linspace(0, 255.1, layers + 1)
    
    with zipfile.ZipFile("paper_planes_layers.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        for i in range(layers):
            layer_mask = (normalized_depth >= bins[i]) & (normalized_depth < bins[i+1]) & mask_array
            
            if np.any(layer_mask):
                layer_rgba = np.zeros((source_array.shape[0], source_array.shape[1], 4), dtype=np.uint8)
                layer_rgba[..., :3] = source_array
                mask_smoothed = cv2.GaussianBlur((layer_mask * 255).astype(np.uint8), (5, 5), 0)
                layer_rgba[..., 3] = mask_smoothed
                
                img_byte_arr = io.BytesIO()
                Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
                zip_file.writestr(f"layer_{i:03d}.png", img_byte_arr.getvalue())
                
    print("Segmentation complete. Output saved to paper_planes_layers.zip.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pipeline.py <job_name>")
        sys.exit(1)
        
    job = sys.argv[1]
    if job == "remove_bg": remove_background()
    elif job == "generate": generate_image()
    elif job == "align": align_images()
    elif job == "depth": extract_depth()
    elif job == "segment": segment_layers()
    else:
        print(f"Unknown job: {job}")
