import os
import io
import zipfile
import cv2
import numpy as np
import glob
import re
from PIL import Image
from concurrent.futures import ThreadPoolExecutor, as_completed

def generate_layer(layer_idx, mask, img_array):
    if not np.any(mask):
        return None
    # Slightly blur the mask to soften the harsh mathematical edges of K-Means
    mask_smoothed = cv2.GaussianBlur((mask * 255).astype(np.uint8), (5, 5), 0)
    layer_rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
    layer_rgba[..., :3] = img_array
    layer_rgba[..., 3] = mask_smoothed
    
    img_byte_arr = io.BytesIO()
    Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
    return f"layer_{layer_idx:03d}.png", img_byte_arr.getvalue()

def run_slaughter():
    print("Firing the Semantic AI. Waking the Mathematical Architect...", flush=True)

    inbox_files = glob.glob("inbox/*")
    if not inbox_files:
        print("No victims found in the inbox.", flush=True)
        return

    target_file = inbox_files[0]
    
    match = re.search(r'_layers-(\d+)\.', target_file)
    layers = int(match.group(1)) if match else 6

    print(f"Executing K-Means Posterization to force exactly {layers} massive groupings...", flush=True)

    original_img = Image.open(target_file).convert("RGB")
    W, H = original_img.size
    
    # We can allow slightly larger images now since we dumped the AI, but 800 is still safe
    MAX_DIM = 800
    if max(H, W) > MAX_DIM:
        scale = MAX_DIM / float(max(H, W))
        new_W, new_H = int(W * scale), int(H * scale)
        original_img = original_img.resize((new_W, new_H), Image.LANCZOS)
        print(f"Victim scaled to {new_W}x{new_H}.", flush=True)

    img_array = np.array(original_img)
    H, W = img_array.shape[:2]
    
    # 1. Blur to remove micro-noise and dust before clustering
    smoothed_img = cv2.GaussianBlur(img_array, (5, 5), 0)
    img_lab = cv2.cvtColor(smoothed_img, cv2.COLOR_RGB2LAB)
    
    # 2. Flatten the image into a list of pixels for the algorithm
    pixel_values = img_lab.reshape((-1, 3))
    pixel_values = np.float32(pixel_values)

    # 3. Force the pixels into EXACTLY `layers` number of color/lightness clusters
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
    _, labels, _ = cv2.kmeans(pixel_values, layers, None, criteria, 10, cv2.KMEANS_RANDOM_CENTERS)
    
    labels = labels.flatten()
    
    # 4. Analyze each mathematical cluster to determine its weight
    clusters = []
    L_channel, A_channel, B_channel = cv2.split(img_lab)

    for k in range(layers):
        mask = (labels == k).reshape((H, W))
        area = np.sum(mask)
        
        if area == 0:
            continue
            
        masked_L = L_channel[mask]
        masked_A = A_channel[mask]
        masked_B = B_channel[mask]

        std_L = np.std(masked_L) if len(masked_L) > 0 else 0
        std_C = np.sqrt(np.std(masked_A)**2 + np.std(masked_B)**2) if len(masked_A) > 0 else 0

        # Normalize variance. 
        norm_L = min(1.0, std_L / 128.0)
        norm_C = min(1.0, std_C / 128.0)

        # Smoothness: 1.0 is dead flat. 0.0 is pure chaos. Lightness counts twice as much.
        smoothness = 1.0 - ((2.0 * norm_L + norm_C) / 3.0)
        
        # The ultimate weight: highly smooth and massive = background.
        # Chaotic and tiny = foreground.
        gravity = (smoothness * 2.0) + (np.log1p(area) * 0.5)

        clusters.append({
            'k': k,
            'mask': mask,
            'gravity': gravity
        })

    # 5. Sort clusters by gravity (descending)
    clusters.sort(key=lambda x: x['gravity'], reverse=True)

    print("Packaging the strata from back to front...", flush=True)
    with zipfile.ZipFile("paper_planes_strata.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        with ThreadPoolExecutor() as executor:
            futures = []
            
            # Since K-Means covers 100% of the image, we don't need to fake a background void.
            # Every pixel belongs to a massive structural group now.
            for i, cluster in enumerate(clusters):
                futures.append(executor.submit(generate_layer, i, cluster['mask'], img_array))
            
            for future in as_completed(futures):
                result = future.result()
                if result:
                    filename, byte_data = result
                    zip_file.writestr(filename, byte_data)
                    print(f"Severed {filename}", flush=True)

    print("Vivisection complete. The math has spoken.", flush=True)

if __name__ == "__main__":
    run_slaughter()
