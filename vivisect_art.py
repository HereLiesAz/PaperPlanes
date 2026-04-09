"""
vivisect_art.py

This script performs a digital vivisection on an image. 
First, it utilizes the rembg library to sever the primary subject from its background.
Next, it employs the Intel/dpt-large depth-estimation pipeline to hallucinate a Z-axis 
onto the isolated subject.
Finally, it slices the subject into discrete, transparent PNG strata based on the 
normalized depth map, ignoring the empty void left by the background removal.

Usage:
    python vivisect_art.py <path_to_painting.jpg> [num_layers]
"""

import numpy as np
from PIL import Image
from transformers import pipeline
from rembg import remove
import sys
import os

def flay_and_vivisect(image_path, num_layers=4):
    """
    Removes the background from the target image, calculates depth, and slices it.
    
    Args:
        image_path (str): The file path to the doomed image.
        num_layers (int, optional): The number of distinct strata to carve out. Defaults to 4.
    """
    if not os.path.exists(image_path):
        print(f"File not found: {image_path}. You cannot flay what isn't there.")
        return

    print(f"Dragging {image_path} to the operating table...")
    original_img = Image.open(image_path).convert("RGBA")

    print("Severing the art from its worldly tethers (background removal)...")
    isolated_img = remove(original_img)
    
    isolated_img.save("isolated_subject.png")
    print("Subject isolated and preserved as isolated_subject.png.")

    print("Summoning the algorithmic guillotine for depth estimation...")
    depth_estimator = pipeline("depth-estimation", model="Intel/dpt-large")
    
    # The depth model requires RGB. We paste the isolated art onto a black void 
    # to prevent it from hallucinating depth in the transparent ether.
    rgb_for_depth = Image.new("RGB", isolated_img.size, (0, 0, 0))
    rgb_for_depth.paste(isolated_img, mask=isolated_img.split()[3])
    
    print("Extracting perceived depth from the isolated subject...")
    depth_result = depth_estimator(rgb_for_depth)
    depth_map = depth_result["depth"]
    depth_array = np.array(depth_map)
    
    img_array = np.array(isolated_img)
    alpha_mask = img_array[:, :, 3] > 0
    
    if not np.any(alpha_mask):
        print("The subject has vanished entirely. Aborting.")
        return

    # Normalize depth map to a clean 0-255 scale, strictly for the surviving pixels.
    subject_depths = depth_array[alpha_mask]
    depth_min = subject_depths.min()
    depth_max = subject_depths.max()
    
    if depth_max == depth_min:
        print("Flatline. The model perceives zero depth in this isolated image.")
        return
        
    depth_normalized = np.zeros_like(depth_array, dtype=float)
    depth_normalized[alpha_mask] = (depth_array[alpha_mask] - depth_min) / (depth_max - depth_min) * 255
    
    thresholds = np.linspace(0, 255, num_layers + 1)
    
    print("Commencing vivisection on the isolated subject...")
    for i in range(num_layers):
        lower = thresholds[i]
        upper = thresholds[i+1]
        
        # Intersect the depth threshold with the alpha mask so we don't slice the void.
        if i == num_layers - 1:
            strata_mask = (depth_normalized >= lower) & (depth_normalized <= upper + 1) & alpha_mask
        else:
            strata_mask = (depth_normalized >= lower) & (depth_normalized < upper) & alpha_mask
            
        layer_data = np.zeros_like(img_array)
        layer_data[strata_mask] = img_array[strata_mask]
        
        layer_index = i + 1
        output_filename = f"layer-{layer_index}.png"
        
        layer_img = Image.fromarray(layer_data, 'RGBA')
        layer_img.save(output_filename)
        print(f"Excised strata {layer_index} and sealed in {output_filename}.")

    print("Autopsy complete. The theater is ready.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python vivisect_art.py <path_to_painting.jpg> [num_layers]")
        sys.exit(1)
        
    target_image = sys.argv[1]
    layers = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    
    flay_and_vivisect(target_image, layers)
