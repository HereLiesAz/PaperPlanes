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
    print("Summoning the Blind Discriminator...", flush=True)
    device = 0 if torch.cuda.is_available() else -1

    # We abandon depth estimation entirely. Physical space is irrelevant to flat art.
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
    
    match = re.search(r'_layers-(\d+)\.', target_file)
    layers = int(match.group(1)) if match else 6
    
    print(f"Preparing to sever {layers} strata based on semantic hierarchy...", flush=True)

    original_img = Image.open(target_file).convert("RGB")
    W, H = original_img.size
    
    MAX_DIM = 800
    if max(H, W) > MAX_DIM:
        scale = MAX_DIM / float(max(H, W))
        new_W = int(W * scale)
        new_H = int(H * scale)
        original_img = original_img.resize((new_W, new_H), Image.LANCZOS)
        print(f"Victim downscaled to {new_W}x{new_H} to survive the memory constraints.", flush=True)

    img_array = np.array(original_img)
    H, W = img_array.shape[:2]
        
    print("Shattering the canvas into semantic shards...", flush=True)
    raw_segments = seg_pipe(original_img)
    
    if isinstance(raw_segments, dict) and "masks" in raw_segments:
        mask_list = list(raw_segments["masks"])
    elif isinstance(raw_segments, list):
        mask_list = [s["mask"] if isinstance(s, dict) and "mask" in s else s for s in raw_segments]
    else:
        mask_list = []

    if not mask_list:
        print("The machine saw nothing. Aborting.", flush=True)
        return

    # Standardize all masks to boolean arrays of the correct shape
    processed_masks = []
    for mask_item in mask_list:
        mask_array = np.array(mask_item)
        if mask_array.shape != (H, W):
            mask_array = cv2.resize(mask_array.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST).astype(bool)
        else:
            mask_array = mask_array > 0
        
        if np.any(mask_array):
            processed_masks.append(mask_array)

    # Sort the masks strictly by Area (Largest to Smallest)
    # The largest shapes are the background. The smallest shapes are the intricate foreground details.
    processed_masks.sort(key=lambda m: np.sum(m), reverse=True)

    # Distribute the sorted masks across the requested number of layers
    masks_per_layer = max(1, len(processed_masks) // layers)
    layer_canvases = [np.zeros((H, W), dtype=bool) for _ in range(layers)]
    claimed_pixels = np.zeros((H, W), dtype=int) - 1 

    print("Stacking the shards from background to foreground...", flush=True)
    for idx, mask_array in enumerate(processed_masks):
        # Determine which strata this mask belongs to based on its size ranking
        layer_idx = min(idx // masks_per_layer, layers - 1)
        
        # Because we process largest to smallest, smaller details will overwrite 
        # the background swaths in the claimed_pixels map.
        claimed_pixels[mask_array] = layer_idx

    # Anything completely ignored by SAM defaults to the background void (Layer 0)
    unclaimed_mask = claimed_pixels == -1
    claimed_pixels[unclaimed_mask] = 0

    for i in range(layers):
        layer_canvases[i] = (claimed_pixels == i)

    foreground_mask = (claimed_pixels > 0).astype(np.uint8) * 255
    
    print("Threading the physical labor and packaging the remains...", flush=True)
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        with ThreadPoolExecutor() as executor:
            futures = []
            
            futures.append(executor.submit(generate_background, img_array, foreground_mask))
            
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

    print("Vivisection complete. The perspective has been destroyed.", flush=True)

if __name__ == "__main__":
    run_slaughter()
