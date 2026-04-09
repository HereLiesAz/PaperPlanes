import os
import io
import zipfile
import cv2
import torch
import numpy as np
import glob
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
        task="image-segmentation", 
        model="facebook/detr-resnet-50-panoptic", 
        device=device
    )

    inbox_files = glob.glob("inbox/*")
    if not inbox_files:
        print("No victims found in the inbox.")
        return

    target_file = inbox_files[0]
    layers = int(os.environ.get("LAYERS", 6))

    original_img = Image.open(target_file).convert("RGB")
    img_array = np.array(original_img)
    
    depth_output = depth_pipe(original_img)
    depth_array = np.array(depth_output["depth"])
    
    depth_min, depth_max = depth_array.min(), depth_array.max()
    normalized_depth = ((depth_array - depth_min) / (depth_max - depth_min) * 255).astype(np.uint8)
    
    if normalized_depth.shape[:2] != img_array.shape[:2]:
        normalized_depth = cv2.resize(
            normalized_depth, 
            (img_array.shape[1], img_array.shape[0]), 
            interpolation=cv2.INTER_LANCZOS4
        )
        
    segments = seg_pipe(original_img)
    
    object_depths = []
    object_masks = []
    
    for segment in segments:
        mask_array = np.array(segment["mask"])
        
        if mask_array.shape != img_array.shape[:2]:
            mask_array = cv2.resize(
                mask_array, 
                (img_array.shape[1], img_array.shape[0]), 
                interpolation=cv2.INTER_NEAREST
            )
        
        binary_mask = mask_array > 0
        if not np.any(binary_mask):
            continue
            
        median_z = np.median(normalized_depth[binary_mask])
        object_depths.append(median_z)
        object_masks.append(binary_mask)
        
    bin_edges = np.linspace(0, 256, layers + 1)
    layer_canvases = [np.zeros((img_array.shape[0], img_array.shape[1]), dtype=bool) for _ in range(layers)]
    
    for median_z, binary_mask in zip(object_depths, object_masks):
        layer_idx = np.digitize(median_z, bin_edges) - 1
        layer_idx = max(0, min(layer_idx, layers - 1))
        layer_canvases[layer_idx] = np.logical_or(layer_canvases[layer_idx], binary_mask)
        
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        for i in range(layers):
            combined_mask = layer_canvases[i]
            mask_smoothed = cv2.GaussianBlur((combined_mask * 255).astype(np.uint8), (5, 5), 0)
            
            layer_rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
            layer_rgba[..., :3] = img_array
            layer_rgba[..., 3] = mask_smoothed
            
            img_byte_arr = io.BytesIO()
            Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
            zip_file.writestr(f"layer_{i:02d}.png", img_byte_arr.getvalue())

    print("Vivisection complete. Artifact packaged.")

if __name__ == "__main__":
    run_slaughter()
