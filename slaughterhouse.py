import os
import io
import zipfile
import cv2
import torch
import numpy as np
import glob
import re
from PIL import Image
from transformers import pipeline
from concurrent.futures import ThreadPoolExecutor, as_completed

def generate_background(img_array, foreground_mask):
    """The slow, agonizing smear of the void."""
    kernel = np.ones((25, 25), np.uint8)
    dilated_mask = cv2.dilate(foreground_mask, kernel, iterations=1)
    inpainted_bg = cv2.inpaint(img_array, dilated_mask, inpaintRadius=30, flags=cv2.INPAINT_TELEA)
    
    bg_byte_arr = io.BytesIO()
    Image.fromarray(inpainted_bg).save(bg_byte_arr, format='PNG')
    return "layer_000.png", bg_byte_arr.getvalue()

def generate_layer(layer_idx, combined_mask, img_array):
    """The quick, violent extraction of a single ghost."""
    if not np.any(combined_mask):
        return None
        
    mask_smoothed = cv2.GaussianBlur((combined_mask * 255).astype(np.uint8), (3, 3), 0)
    layer_rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
    layer_rgba[..., :3] = img_array
    layer_rgba[..., 3] = mask_smoothed
    
    img_byte_arr = io.BytesIO()
    Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
    return f"layer_{layer_idx:03d}.png", img_byte_arr.getvalue()

def run_slaughter():
    # flush=True is required or GitHub Actions will hide your dying screams
    print("Summoning the neural weights...", flush=True)
    device = 0 if torch.cuda.is_available() else -1

    depth_pipe = pipeline(
        task="depth-estimation", 
        model="depth-anything/Depth-Anything-V2-Small-hf", 
        device=device
    )
    
    seg_pipe = pipeline(
        task="mask-generation", 
        model="facebook/sam-vit-base", 
        device=device
    )

    inbox_files = glob.glob("inbox/*")
    if not inbox_files:
        print("No victims found in the inbox.", flush=True)
        return

    target_file = inbox_files[0]
    
    # Read the strata count from the victim's toe tag
    match = re.search(r'_layers-(\d+)\.', target_file)
    layers = int(match.group(1)) if match else 6
    
    print(f"Preparing to sever {layers} strata...", flush=True)

    original_img = Image.open(target_file).convert("RGB")
    W, H = original_img.size
    
    # Force compliance with the limits of free infrastructure
    MAX_DIM = 800
    if max(H, W) > MAX_DIM:
        scale = MAX_DIM / float(max(H, W))
        new_W = int(W * scale)
        new_H = int(H * scale)
        original_img = original_img.resize((new_W, new_H), Image.LANCZOS)
        print(f"Victim aggressively downscaled from {W}x{H} to {new_W}x{new_H} to prevent the void from collapsing.", flush=True)

    img_array = np.array(original_img)
    H, W = img_array.shape[:2]
    
    print("Hallucinating the Z-axis...", flush=True)
    depth_output = depth_pipe(original_img)
    depth_array = np.array(depth_output["depth"])
    
    depth_min, depth_max = depth_array.min(), depth_array.max()
    if depth_max > depth_min:
        normalized_depth = ((depth_array - depth_min) / (depth_max - depth_min) * 255).astype(np.uint8)
    else:
        normalized_depth = np.zeros_like(depth_array, dtype=np.uint8)
    
    if normalized_depth.shape[:2] != (H, W):
        normalized_depth = cv2.resize(
            normalized_depth, 
            (W, H), 
            interpolation=cv2.INTER_LANCZOS4
        )
        
    print("Isolating cohesive brushstrokes and agnostic forms...", flush=True)
    raw_segments = seg_pipe(original_img)
    
    # Handle shifting dictionary structures from the pipeline
    if isinstance(raw_segments, dict) and "masks" in raw_segments:
        mask_list = list(raw_segments["masks"])
    elif isinstance(raw_segments, list):
        mask_list = [s["mask"] if isinstance(s, dict) and "mask" in s else s for s in raw_segments]
    else:
        mask_list = []

    mask_list.sort(key=lambda m: np.sum(np.array(m) > 0), reverse=True)

    bin_edges = np.linspace(0, 256, layers + 1)
    layer_canvases = [np.zeros((H, W), dtype=bool) for _ in range(layers)]
    claimed_pixels = np.zeros((H, W), dtype=int) - 1 
    
    print("Assigning forms to their definitive strata...", flush=True)
    for mask_item in mask_list:
        mask_array = np.array(mask_item)
        if mask_array.shape != (H, W):
            mask_array = cv2.resize(
                mask_array.astype(np.uint8), 
                (W, H), 
                interpolation=cv2.INTER_NEAREST
            ).astype(bool)
        else:
            mask_array = mask_array > 0

        if not np.any(mask_array):
            continue
            
        median_z = np.median(normalized_depth[mask_array])
        layer_idx = np.digitize(median_z, bin_edges) - 1
        layer_idx = max(0, min(layer_idx, layers - 1))
        claimed_pixels[mask_array] = layer_idx

    print("Sweeping the unpainted void...", flush=True)
    unclaimed_mask = claimed_pixels == -1
    if np.any(unclaimed_mask):
        raw_depth_layers = np.digitize(normalized_depth, bin_edges) - 1
        raw_depth_layers = np.clip(raw_depth_layers, 0, layers - 1)
        claimed_pixels[unclaimed_mask] = raw_depth_layers[unclaimed_mask]

    for i in range(layers):
        layer_canvases[i] = (claimed_pixels == i)

    foreground_mask = (claimed_pixels > 0).astype(np.uint8) * 255
    
    print("Threading the physical labor and packaging the remains...", flush=True)
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        with ThreadPoolExecutor() as executor:
            futures = []
            
            futures.append(
                executor.submit(generate_background, img_array, foreground_mask)
            )
            
            for i in range(1, layers):
                combined_mask = layer_canvases[i]
                if np.any(combined_mask):
                    futures.append(
                        executor.submit(generate_layer, i, combined_mask, img_array)
                    )
            
            for future in as_completed(futures):
                result = future.result()
                if result:
                    filename, byte_data = result
                    zip_file.writestr(filename, byte_data)
                    print(f"Severed {filename}", flush=True)

    print("Vivisection complete. Artifact packaged.", flush=True)

if __name__ == "__main__":
    run_slaughter()

