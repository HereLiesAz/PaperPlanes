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

def run_slaughter():
    inbox_files = glob.glob("inbox/*")
    if not inbox_files:
        return

    target_file = inbox_files[0]
    match = re.search(r'_layers-(\d+)\.', target_file)
    layers = int(match.group(1)) if match else 6

    original_img = Image.open(target_file).convert("RGB")
    W, H = original_img.size
    
    MAX_DIM = 800
    if max(H, W) > MAX_DIM:
        scale = MAX_DIM / float(max(H, W))
        original_img = original_img.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
        
    img_array = np.array(original_img)
    H, W = img_array.shape[:2]

    # Outsmarting reality: We blind the depth estimator to the physical wall.
    # We crush the physical texture using bilateral filtering, then violently invert the luminance.
    # The dark graffiti becomes blindingly bright. The depth neural network is tricked into 
    # reading the inverted paint as a massive 3D object exploding out of a dark void.
    melted = img_array.copy()
    for _ in range(3): 
        melted = cv2.bilateralFilter(melted, 15, 80, 80)
        
    lab = cv2.cvtColor(melted, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    
    l_inverted = cv2.bitwise_not(l)
    lab_inverted = cv2.merge((l_inverted, a, b))
    hallucination_bait = cv2.cvtColor(lab_inverted, cv2.COLOR_LAB2RGB)

    device = 0 if torch.cuda.is_available() else -1
    depth_pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device)
    
    depth_result = depth_pipe(Image.fromarray(hallucination_bait))
    depth_array = np.array(depth_result["depth"])
    
    cv2.normalize(depth_array, depth_array, 0, 255, cv2.NORM_MINMAX)

    bins = np.linspace(0, 255.1, layers + 1)
    layer_canvases = [(depth_array >= bins[i]) & (depth_array < bins[i+1]) for i in range(layers)]

    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        depth_byte_arr = io.BytesIO()
        Image.fromarray(depth_array.astype(np.uint8)).save(depth_byte_arr, format='PNG')
        zip_file.writestr("hallucinated_depth_map.png", depth_byte_arr.getvalue())

        with ThreadPoolExecutor() as executor:
            futures = [executor.submit(generate_layer, i, layer_canvases[i], img_array) for i in range(layers)]
            for future in as_completed(futures):
                result = future.result()
                if result:
                    zip_file.writestr(result[0], result[1])

if __name__ == "__main__":
    run_slaughter()
