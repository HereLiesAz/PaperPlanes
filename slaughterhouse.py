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
    # The Seer of Distance. (Surprisingly robust on paintings due to diverse training data).
    depth_pipe = pipeline(
        task="depth-estimation", 
        model="depth-anything/Depth-Anything-V2-Small-hf", 
        device=device
    )
    
    # The Blind Discriminator. 
    # SAM (Segment Anything) doesn't need to know what an object is to cut it out.
    seg_pipe = pipeline(
        task="mask-generation", 
        model="facebook/sam-vit-base", 
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
        
    print("Isolating cohesive brushstrokes and agnostic forms...")
    # SAM returns overlapping masks of everything it perceives as a distinct visual entity.
    segments = seg_pipe(original_img)
    
    # Sort masks by area (largest to smallest) so smaller foreground details 
    # overwrite larger background swaths when establishing pixel ownership.
    segments.sort(key=lambda x: np.sum(np.array(x["mask"])), reverse=True)

    bin_edges = np.linspace(0, 256, layers + 1)
    layer_canvases = [np.zeros((H, W), dtype=bool) for _ in range(layers)]
    
    # Track which pixels have been claimed by an object to sweep up the rest later.
    claimed_pixels = np.zeros((H, W), dtype=int) - 1 
    
    print("Assigning forms to their definitive strata...")
    for segment in segments:
        mask_array = np.array(segment["mask"])
        
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
            
        # The entire cohesive painted form is flattened to its median depth.
        median_z = np.median(normalized_depth[mask_array])
        
        layer_idx = np.digitize(median_z, bin_edges) - 1
        layer_idx = max(0, min(layer_idx, layers - 1))
        
        # Overwrite pixel ownership with this shape's designated layer
        claimed_pixels[mask_array] = layer_idx

    print("Sweeping the unpainted void...")
    # Any pixels SAM failed to group into a cohesive shape fall back to their raw depth.
    unclaimed_mask = claimed_pixels == -1
    if np.any(unclaimed_mask):
        raw_depth_layers = np.digitize(normalized_depth, bin_edges) - 1
        raw_depth_layers = np.clip(raw_depth_layers, 0, layers - 1)
        claimed_pixels[unclaimed_mask] = raw_depth_layers[unclaimed_mask]

    # Transfer the final ownership map into the discrete layer canvases
    for i in range(layers):
        layer_canvases[i] = (claimed_pixels == i)

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
