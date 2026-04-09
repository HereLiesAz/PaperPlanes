import os
import io
import zipfile
import cv2
import torch
import numpy as np
import glob
import re
import gc
from PIL import Image
from transformers import pipeline
from rembg import remove
from concurrent.futures import ThreadPoolExecutor, as_completed

def generate_layer(layer_idx, mask, img_array):
    if not np.any(mask):
        return None
    mask_smoothed = cv2.GaussianBlur((mask * 255).astype(np.uint8), (5, 5), 0)
    layer_rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
    layer_rgba[..., :3] = img_array
    layer_rgba[..., 3] = mask_smoothed
    img_byte_arr = io.BytesIO()
    Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
    return f"layer_{layer_idx:03d}.png", img_byte_arr.getvalue()

def align_images(source_img, target_img):
    print("Forcing the hallucination to map to reality (ORB Feature Matching)...", flush=True)
    # Convert to grayscale for feature extraction
    gray_src = cv2.cvtColor(source_img, cv2.COLOR_RGB2GRAY)
    gray_tgt = cv2.cvtColor(target_img, cv2.COLOR_RGB2GRAY)

    # Awaken ORB (Oriented FAST and Rotated BRIEF)
    orb = cv2.ORB_create(MAX_FEATURES=5000)
    kp_src, des_src = orb.detectAndCompute(gray_src, None)
    kp_tgt, des_tgt = orb.detectAndCompute(gray_tgt, None)

    # Match the features using Brute Force with Hamming distance
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    matches = bf.knnMatch(des_src, des_tgt, k=2)

    # Lowe's ratio test to filter out weak geometric hallucinations
    good_matches = []
    for m, n in matches:
        if m.distance < 0.75 * n.distance:
            good_matches.append(m)

    if len(good_matches) < 10:
        print("Warning: The hallucination is too mutated. Alignment failed. Falling back to unaligned.", flush=True)
        return target_img

    # Extract coordinates of good matches
    src_pts = np.float32([kp_src[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    tgt_pts = np.float32([kp_tgt[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

    # Find the perspective mathematical distortion (Homography)
    matrix, mask = cv2.findHomography(tgt_pts, src_pts, cv2.RANSAC, 5.0)

    if matrix is None:
        print("Warning: Homography matrix collapsed. Falling back to unaligned.", flush=True)
        return target_img

    # Violently warp the hallucination to fit the physical bones
    h, w = source_img.shape[:2]
    aligned_target = cv2.warpPerspective(target_img, matrix, (w, h))
    return aligned_target

def run_slaughter():
    print("Initiating the Chimera Pipeline...", flush=True)

    inbox_files = glob.glob("inbox/*")
    
    # Identify the victims
    original_path = next((f for f in inbox_files if 'original' in f.lower()), None)
    generated_path = next((f for f in inbox_files if 'generated' in f.lower()), None)

    if not original_path or not generated_path:
        print("Pipeline starved. Both 'original' and 'generated' images must be in the inbox.", flush=True)
        return

    # Determine requested strata (default to 6 if not specified in original filename)
    match = re.search(r'_layers-(\d+)\.', original_path)
    layers = int(match.group(1)) if match else 6

    # Load and chokehold the original reality to 800px
    orig_pil = Image.open(original_path).convert("RGB")
    W, H = orig_pil.size
    MAX_DIM = 800
    if max(H, W) > MAX_DIM:
        scale = MAX_DIM / float(max(H, W))
        orig_pil = orig_pil.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
    
    img_array_original = np.array(orig_pil)
    target_W, target_H = orig_pil.size

    # --- PHASE 1: STRIP THE REALITY ---
    print("Phase 1: Stripping the background from the original reality...", flush=True)
    # rembg requires a PIL image and returns a PIL image (RGBA)
    orig_nobg_pil = remove(orig_pil)
    img_array_nobg = np.array(orig_nobg_pil)
    
    # Extract the alpha channel to know exactly where the subject is
    subject_mask = img_array_nobg[:, :, 3] > 0
    
    # We drop rembg from memory immediately to protect the cloud runner
    del orig_nobg_pil
    gc.collect()

    # --- PHASE 2: ALIGN THE HALLUCINATION ---
    print("Phase 2: Warping the dream to fit the corpse...", flush=True)
    gen_pil = Image.open(generated_path).convert("RGB")
    gen_pil = gen_pil.resize((target_W, target_H), Image.LANCZOS)
    img_array_generated = np.array(gen_pil)

    aligned_generated = align_images(img_array_original, img_array_generated)

    # --- PHASE 3: EXTRACT THE Z-AXIS FROM THE DREAM ---
    print("Phase 3: Waking the Seer to hallucinate depth from the aligned dream...", flush=True)
    device = 0 if torch.cuda.is_available() else -1
    depth_pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device)
    
    depth_result = depth_pipe(Image.fromarray(aligned_generated))
    depth_array = np.array(depth_result["depth"]).astype(np.float32)

    # Burn the neural network from memory
    del depth_pipe
    gc.collect()

    # --- PHASE 4: THE VIVISECTION ---
    print("Phase 4: Slicing the original reality using the dream's geometry...", flush=True)
    
    # We only care about the depth of the isolated subject, not the void behind it
    subject_depth = depth_array[subject_mask]
    
    if len(subject_depth) == 0:
        print("Error: The background remover devoured the entire image.", flush=True)
        return

    # Normalize depth purely within the boundaries of the extracted subject
    min_depth = subject_depth.min()
    max_depth = subject_depth.max()
    
    normalized_depth = np.zeros_like(depth_array)
    normalized_depth[subject_mask] = np.interp(depth_array[subject_mask], (min_depth, max_depth), (0, 255))

    # Slice the normalized depth into strict topographical bins
    bins = np.linspace(0, 255.1, layers + 1)
    layer_canvases = [np.zeros((target_H, target_W), dtype=bool) for _ in range(layers)]
    
    for i in range(layers):
        lower_bound = bins[i]
        upper_bound = bins[i+1]
        # A pixel belongs to this layer IF it is within depth bounds AND it survived the background removal
        layer_mask = (normalized_depth >= lower_bound) & (normalized_depth < upper_bound) & subject_mask
        layer_canvases[i] = layer_mask

    print("Packaging the strata...", flush=True)
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        
        # Save the hallucinated depth map for the autopsy
        depth_byte_arr = io.BytesIO()
        Image.fromarray(normalized_depth.astype(np.uint8)).save(depth_byte_arr, format='PNG')
        zip_file.writestr("chimera_depth_map.png", depth_byte_arr.getvalue())

        with ThreadPoolExecutor() as executor:
            futures = []
            
            # We slice the ORIGINAL un-altered image using the calculated masks
            for i in range(layers):
                futures.append(executor.submit(generate_layer, i, layer_canvases[i], img_array_original))
            
            for future in as_completed(futures):
                result = future.result()
                if result:
                    filename, byte_data = result
                    zip_file.writestr(filename, byte_data)
                    print(f"Severed {filename}", flush=True)

    print("Vivisection complete. The Chimera breathes.", flush=True)

if __name__ == "__main__":
    run_slaughter()
