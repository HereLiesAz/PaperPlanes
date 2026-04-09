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

    print("Summoning the neural weights...")
    depth_pipe = pipeline(
        task="depth-estimation", 
        model="depth-anything/Depth-Anything-V2-Small-hf", 
        device=device
    )
    
    # We return to the Panoptic Segmenter to enforce semantic boundaries.
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
    H, W = img_array.shape[:2]
    
    print("Hallucinating the Z-axis...")
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
        
    print("Interrogating reality for semantic meaning...")
    # Panoptic segmentation forces every pixel into a conceptual category.
    segments = seg_pipe(original_img)
    
    bin_edges = np.linspace(0, 256, layers + 1)
    layer_canvases = [np.zeros((H, W), dtype=bool) for _ in range(layers)]
    claimed_pixels = np.zeros((H, W), dtype=bool)
    
    print("Assigning concepts to their definitive strata...")
    for segment in segments:
        mask_array = np.array(segment["mask"])
        
        if mask_array.shape != (H, W):
            mask_array = cv2.resize(
                mask_array, 
                (W, H), 
                interpolation=cv2.INTER_NEAREST
            )
        
        binary_mask = mask_array > 0
        if not np.any(binary_mask):
            continue
            
        # The entire semantic object is flattened to its median depth.
        # This prevents gradients from tearing a single object across multiple layers.
        median_z = np.median(normalized_depth[binary_mask])
        
        layer_idx = np.digitize(median_z, bin_edges) - 1
        layer_idx = max(0, min(layer_idx, layers - 1))
        
        layer_canvases[layer_idx] = np.logical_or(layer_canvases[layer_idx], binary_mask)
        claimed_pixels = np.logical_or(claimed_pixels, binary_mask)

    # In the rare event the panoptic model experiences a lapse in judgment 
    # and leaves a pocket of reality unnamed, we banish the amnesiac void 
    # to the absolute background so it doesn't leave literal holes in the image.
    unclaimed_mask = ~claimed_pixels
    if np.any(unclaimed_mask):
        layer_canvases[0] = np.logical_or(layer_canvases[0], unclaimed_mask)

    print("Packaging the severed remains...")
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        for i in range(layers):
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

    print("Vivisection complete. Artifact packaged.")

if __name__ == "__main__":
    run_slaughter()
