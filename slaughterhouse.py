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
    kernel = np.ones((15, 15), np.uint8)
    dilated_mask = cv2.dilate(foreground_mask, kernel, iterations=1)
    inpainted_bg = cv2.inpaint(img_array, dilated_mask, inpaintRadius=20, flags=cv2.INPAINT_TELEA)
    bg_byte_arr = io.BytesIO()
    Image.fromarray(inpainted_bg).save(bg_byte_arr, format='PNG')
    return "layer_000.png", bg_byte_arr.getvalue()

def generate_layer(layer_idx, combined_mask, img_array):
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
    print("Waking the Blind Discriminator (SAM) on the free tier...", flush=True)
    device = 0 if torch.cuda.is_available() else -1
    seg_pipe = pipeline("mask-generation", model="facebook/sam-vit-base", device=device)

    inbox_files = glob.glob("inbox/*")
    if not inbox_files:
        print("No victims found in the inbox.", flush=True)
        return

    target_file = inbox_files[0]
    
    match = re.search(r'_layers-(\d+)\.', target_file)
    layers = int(match.group(1)) if match else 6

    print(f"Preparing to sever {layers} strata based on logarithmic mass...", flush=True)

    original_img = Image.open(target_file).convert("RGB")
    W, H = original_img.size
    
    # GitHub Actions will OOM instantly if we push past 800 on a CPU
    MAX_DIM = 800
    if max(H, W) > MAX_DIM:
        scale = MAX_DIM / float(max(H, W))
        new_W, new_H = int(W * scale), int(H * scale)
        original_img = original_img.resize((new_W, new_H), Image.LANCZOS)
        print(f"Victim aggressively downscaled to {new_W}x{new_H} to prevent kernel panic.", flush=True)

    img_array = np.array(original_img)
    H, W = img_array.shape[:2]
    TOTAL_PIXELS = H * W
        
    print("Shattering the canvas into semantic shards...", flush=True)
    raw_segments = seg_pipe(original_img)
    
    mask_list = []
    if isinstance(raw_segments, dict) and "masks" in raw_segments:
        mask_list = list(raw_segments["masks"])
    elif isinstance(raw_segments, list):
        mask_list = [s["mask"] if isinstance(s, dict) and "mask" in s else s for s in raw_segments]

    if not mask_list:
        print("The machine saw nothing. Aborting.", flush=True)
        return

    processed_masks = []
    areas = []
    for mask_item in mask_list:
        mask_array = np.array(mask_item)
        if mask_array.shape != (H, W):
            mask_array = cv2.resize(mask_array.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST).astype(bool)
        else:
            mask_array = mask_array > 0
        
        area = np.sum(mask_array)
        # Ignore useless bounding boxes that cover the whole image, and microscopic noise
        if area > 10 and area < (TOTAL_PIXELS * 0.95):
            processed_masks.append(mask_array)
            areas.append(area)

    # Sort masks strictly by Area (Largest to Smallest)
    sort_idx = np.argsort(areas)[::-1]
    processed_masks = [processed_masks[i] for i in sort_idx]
    areas = np.array([areas[i] for i in sort_idx])

    # Convert areas to a logarithmic scale
    log_areas = np.log1p(areas)
    min_log, max_log = log_areas.min(), log_areas.max()
    
    # Divide the logarithmic area scale into equal strata bins
    bin_edges = np.linspace(min_log, max_log, layers)
    
    layer_canvases = [np.zeros((H, W), dtype=bool) for _ in range(layers)]
    claimed_pixels = np.zeros((H, W), dtype=int) - 1 

    for idx, mask_array in enumerate(processed_masks):
        mask_log = log_areas[idx]
        
        # Find which mathematical bin this mask falls into
        layer_idx = np.digitize(mask_log, bin_edges) - 1
        layer_idx = np.clip(layer_idx, 0, layers - 1)
        
        # Invert the index so the most massive areas fall to the back (Layer 0) 
        layer_idx = (layers - 1) - layer_idx
        
        claimed_pixels[mask_array] = layer_idx

    # Send the completely unclaimed void to the background
    unclaimed_mask = claimed_pixels == -1
    claimed_pixels[unclaimed_mask] = 0

    for i in range(layers):
        layer_canvases[i] = (claimed_pixels == i)

    foreground_mask = (claimed_pixels > 0).astype(np.uint8) * 255
    
    print("Threading the physical labor and packaging the remains...", flush=True)
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        with ThreadPoolExecutor() as executor:
            futures = [executor.submit(generate_background, img_array, foreground_mask)]
            
            for i in range(1, layers):
                combined_mask = layer_canvases[i]
                if np.any(combined_mask):
                    futures.append(executor.submit(generate_layer, i, combined_mask, img_array))
            
            for future in as_completed(futures):
                result = future.result()
                if result:
                    filename, byte_data = result
                    zip_file.writestr(filename, byte_data)
                    print(f"Severed {filename}", flush=True)

    print("Vivisection complete. Artifact packaged.", flush=True)

if __name__ == "__main__":
    run_slaughter()
