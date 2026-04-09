import io
import zipfile
import cv2
import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from transformers import pipeline

app = FastAPI(title="Paper Planes API - Semantic Vivisection")

device = 0 if torch.cuda.is_available() else -1

# The seer of distance
depth_pipe = pipeline(
    task="depth-estimation", 
    model="depth-anything/Depth-Anything-V2-Small-hf", 
    device=device
)
# The discriminator of objects (Panoptic Segmentation)
seg_pipe = pipeline(
    task="image-segmentation", 
    model="facebook/detr-resnet-50-panoptic", 
    device=device
)

@app.post("/dissect")
async def dissect(file: UploadFile = File(...), layers: int = Form(6)):
    """
    POST a reality. The image is parsed into semantic objects, 
    weighed for their median depth, and distributed intact across the Z-axis.
    """
    image_data = await file.read()
    original_img = Image.open(io.BytesIO(image_data)).convert("RGB")
    img_array = np.array(original_img)
    
    # 1. Hallucinate depth
    depth_output = depth_pipe(original_img)
    depth_array = np.array(depth_output["depth"])
    
    # Normalize depth map to 0-255 (0 = furthest, 255 = closest)
    depth_min, depth_max = depth_array.min(), depth_array.max()
    normalized_depth = ((depth_array - depth_min) / (depth_max - depth_min) * 255).astype(np.uint8)
    
    if normalized_depth.shape[:2] != img_array.shape[:2]:
        normalized_depth = cv2.resize(
            normalized_depth, 
            (img_array.shape[1], img_array.shape[0]), 
            interpolation=cv2.INTER_LANCZOS4
        )
        
    # 2. Discriminate reality into semantic objects
    segments = seg_pipe(original_img)
    
    # 3. Marry semantics with topology
    object_depths = []
    object_masks = []
    
    for segment in segments:
        mask_array = np.array(segment["mask"])
        
        # Ensure the mask perfectly aligns with the original dimensions
        if mask_array.shape != img_array.shape[:2]:
            mask_array = cv2.resize(
                mask_array, 
                (img_array.shape[1], img_array.shape[0]), 
                interpolation=cv2.INTER_NEAREST
            )
        
        # Isolate the boolean shape
        binary_mask = mask_array > 0
        if not np.any(binary_mask):
            continue
            
        # Determine the object's true place in the void by its median depth,
        # ignoring the statistical noise of its jagged edges.
        median_z = np.median(normalized_depth[binary_mask])
        
        object_depths.append(median_z)
        object_masks.append(binary_mask)
        
    # 4. Bin the intact entities into the requested strata
    bin_edges = np.linspace(0, 256, layers + 1)
    layer_canvases = [np.zeros((img_array.shape[0], img_array.shape[1]), dtype=bool) for _ in range(layers)]
    
    for median_z, binary_mask in zip(object_depths, object_masks):
        # Find which plane of existence this object belongs to
        layer_idx = np.digitize(median_z, bin_edges) - 1
        layer_idx = max(0, min(layer_idx, layers - 1)) # Prevent out-of-bounds exile
        
        # Merge the object into its designated layer
        layer_canvases[layer_idx] = np.logical_or(layer_canvases[layer_idx], binary_mask)
        
    # 5. Pack the severed remains
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        for i in range(layers):
            combined_mask = layer_canvases[i]
            
            # Feather the edges so the illusion of reality isn't totally shattered
            mask_smoothed = cv2.GaussianBlur((combined_mask * 255).astype(np.uint8), (5, 5), 0)
            
            layer_rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
            layer_rgba[..., :3] = img_array
            layer_rgba[..., 3] = mask_smoothed
            
            img_byte_arr = io.BytesIO()
            Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
            zip_file.writestr(f"layer_{i:02d}.png", img_byte_arr.getvalue())
            
    zip_buffer.seek(0)
    
    return StreamingResponse(
        zip_buffer, 
        media_type="application/zip", 
        headers={"Content-Disposition": "attachment; filename=paper_planes_semantic.zip"}
    )
