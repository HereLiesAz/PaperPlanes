import io
import zipfile
import cv2
import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from transformers import pipeline

app = FastAPI(title="Paper Planes API")

# Initialize the blade once to avoid loading weights on every request
device = 0 if torch.cuda.is_available() else -1
pipe = pipeline(task="depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device)

@app.post("/dissect")
async def dissect(file: UploadFile = File(...), layers: int = Form(6)):
    """
    POST a reality. Receive a ZIP file containing discrete PNG layers.
    """
    image_data = await file.read()
    original_img = Image.open(io.BytesIO(image_data)).convert("RGB")
    img_array = np.array(original_img)
    
    # Hallucinate depth
    depth_output = pipe(original_img)
    depth_array = np.array(depth_output["depth"])
    
    # Normalize 0-255
    depth_min = depth_array.min()
    depth_max = depth_array.max()
    normalized_depth = ((depth_array - depth_min) / (depth_max - depth_min) * 255).astype(np.uint8)
    
    if normalized_depth.shape[:2] != img_array.shape[:2]:
        normalized_depth = cv2.resize(normalized_depth, (img_array.shape[1], img_array.shape[0]), interpolation=cv2.INTER_LANCZOS4)
        
    bin_edges = np.linspace(0, 256, layers + 1)
    
    # Pack the remains into a zip archive in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        for i in range(layers):
            mask = np.logical_and(normalized_depth >= bin_edges[i], normalized_depth < bin_edges[i+1])
            mask_smoothed = cv2.GaussianBlur((mask * 255).astype(np.uint8), (5, 5), 0)
            
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
        headers={"Content-Disposition": "attachment; filename=paper_planes_strata.zip"}
    )
