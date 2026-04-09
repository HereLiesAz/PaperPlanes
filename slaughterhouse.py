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

def run_slaughter():
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
        return

    target_file = inbox_files[0]
    
    # Read the strata count from the victim's toe tag
    match = re.search(r'_layers-(\d+)\.', target_file)
    layers = int(match.group(1)) if match else 6

    original_img = Image.open(target_file).convert("RGB")
    img_array = np.array(original_img)
    H, W = img_array.shape[:2]
    
    depth_output = depth_pipe(original_img)
    depth_array = np.array(depth_output["depth"])
    
    depth_min, depth_max = depth_array.min(), depth_array.max()
    normalized_depth = ((depth_array - depth_min) / (depth_max - depth_min) * 255).astype(np.uint8)
    
    if normalized_depth.shape[:2] != (H, W):
        normalized_depth = cv2.resize(
            normalized_depth, 
            (W, H), 
            interpolation=cv2.INTER_LANCZOS4
        )
        
    raw_segments = seg_pipe(original_img)
    
    # Extract the masks regardless of how the pipeline structures the dictionary
    if isinstance(raw_segments, dict) and "masks" in raw_segments:
        mask_list = list(raw_segments["masks"])
    elif isinstance(raw_segments, list):
        mask_list = [s["mask"] if isinstance(s, dict) and "mask" in s else s for s in raw_segments]
    else:
        mask_list = []

    # Sort masks by area (largest to smallest)
    mask_list.sort(key=lambda m: np.sum(np.array(m) > 0), reverse=True)

    bin_edges = np.linspace(0, 256, layers + 1)
    layer_canvases = [np.zeros((H, W), dtype=bool) for _ in range(layers)]
    claimed_pixels = np.zeros((H, W), dtype=int) - 1 
    
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

    unclaimed_mask = claimed_pixels == -1
    if np.any(unclaimed_mask):
        raw_depth_layers = np.digitize(normalized_depth, bin_edges) - 1
        raw_depth_layers = np.clip(raw_depth_layers, 0, layers - 1)
        claimed_pixels[unclaimed_mask] = raw_depth_layers[unclaimed_mask]

    for i in range(layers):
        layer_canvases[i] = (claimed_pixels == i)

    foreground_mask = (claimed_pixels > 0).astype(np.uint8) * 255
    
    kernel = np.ones((25, 25), np.uint8)
    dilated_mask = cv2.dilate(foreground_mask, kernel, iterations=1)
    
    inpainted_bg = cv2.inpaint(img_array, dilated_mask, inpaintRadius=30, flags=cv2.INPAINT_TELEA)

    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        bg_byte_arr = io.BytesIO()
        Image.fromarray(inpainted_bg).save(bg_byte_arr, format='PNG')
        zip_file.writestr("layer_000.png", bg_byte_arr.getvalue())

        for i in range(1, layers):
            combined_mask = layer_canvases[i]
            if not np.any(combined_mask):
                continue
                
            mask_smoothed = cv2.GaussianBlur((combined_mask * 255).astype(np.uint8), (3, 3), 0)
            layer_rgba = np.zeros((H, W, 4), dtype=np.uint8)
            layer_rgba[..., :3] = img_array
            layer_rgba[..., 3] = mask_smoothed
            
            img_byte_arr = io.BytesIO()
            Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
            zip_file.writestr(f"layer_{i:03d}.png", img_byte_arr.getvalue())

if __name__ == "__main__":
    run_slaughter()
