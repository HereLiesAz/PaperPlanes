import sys
import os
import io
import zipfile
import glob
import re
import cv2
import numpy as np
import time
from PIL import Image

def log(msg):
    t = time.strftime("%H:%M:%S")
    print(f"[{t}] {msg}", flush=True)

def get_input_file():
    files = glob.glob("inbox/*")
    log(f"Scanning inbox. Found: {files}")
    target = next((f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg'))), None)
    log(f"Selected target: {target}")
    return target

def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def perspective_crop():
    log("=== JOB 1: PERSPECTIVE & CROP ===")
    os.makedirs("workspace", exist_ok=True)
    file_path = get_input_file()
    
    if not file_path:
        log("FATAL: No valid image found in inbox.")
        sys.exit(1)
        
    image = cv2.imread(file_path)
    orig = image.copy()
    
    manual_coords = os.getenv("MANUAL_COORDS", "").strip()
    if manual_coords:
        log(f"Manual reality override detected. Injecting coordinates: {manual_coords}")
        pts = np.array([float(x) for x in manual_coords.split(',')]).reshape(4, 2)
        rect = order_points(pts)
        (tl, tr, br, bl) = rect
        
        widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
        widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
        maxWidth = max(int(widthA), int(widthB))
        
        heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
        heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
        maxHeight = max(int(heightA), int(heightB))
        
        dst = np.array([
            [0, 0],
            [maxWidth - 1, 0],
            [maxWidth - 1, maxHeight - 1],
            [0, maxHeight - 1]], dtype="float32")
            
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(orig, M, (maxWidth, maxHeight))
        
        success = cv2.imwrite("workspace/cropped_image.png", warped)
        if success:
            log("Manual mathematical amputation successful. Saved to workspace/cropped_image.png")
        else:
            log("FATAL: OpenCV failed to construct the severed artifact.")
            sys.exit(1)
        return
    
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(gray, 75, 200)
    
    cnts, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]
    
    screenCnt = None
    for c in cnts:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4:
            screenCnt = approx
            break
            
    if screenCnt is not None:
        log("Painting boundaries detected. Warping perspective to face straight on.")
        pts = screenCnt.reshape(4, 2)
        rect = order_points(pts)
        (tl, tr, br, bl) = rect
        
        widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
        widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
        maxWidth = max(int(widthA), int(widthB))
        
        heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
        heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
        maxHeight = max(int(heightA), int(heightB))
        
        dst = np.array([
            [0, 0],
            [maxWidth - 1, 0],
            [maxWidth - 1, maxHeight - 1],
            [0, maxHeight - 1]], dtype="float32")
            
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(orig, M, (maxWidth, maxHeight))
        
        success = cv2.imwrite("workspace/cropped_image.png", warped)
        if success:
            log("Cropped and warped image saved to workspace/cropped_image.png")
        else:
            log("FATAL: OpenCV failed to construct the auto-cropped artifact.")
            sys.exit(1)
    else:
        log("No definitive 4-point boundaries found. Preserving original bounds.")
        cv2.imwrite("workspace/cropped_image.png", orig)

def generate_image():
    log("=== JOB 2: GENERATE HALLUCINATION ===")
    import torch
    from diffusers import StableDiffusionImg2ImgPipeline
    
    file_path = "workspace/cropped_image.png"
    if not os.path.exists(file_path):
        log("FATAL: cropped_image.png not found. Run perspective_crop first.")
        sys.exit(1)
        
    log(f"Loading cropped image: {file_path}")
    init_image = Image.open(file_path).convert("RGB")
    
    log("Loading Nano Banana 2...")
    start_time = time.time()
    
    try:
        pipe = StableDiffusionImg2ImgPipeline.from_pretrained("nano-banana-2", torch_dtype=torch.float32)
    except Exception:
        log("Nano Banana 2 slipped on a peel. Defaulting to SD 2.1 to outsmart reality.")
        pipe = StableDiffusionImg2ImgPipeline.from_pretrained("stabilityai/stable-diffusion-2-1", torch_dtype=torch.float32)
        
    pipe.safety_checker = None
    log(f"Pipeline loaded in {time.time() - start_time:.2f} seconds.")
    
    prompt = os.getenv("CUSTOM_PROMPT", "").strip()
    if not prompt:
        prompt = "Turn this painting into a photograph"
        log("No manual override detected. Executing default directive.")
    else:
        log("Manual override detected. Injecting user semantics.")

    log(f"Executing generation with prompt: '{prompt}'")
    log("Strength: 0.65, Guidance: 7.5")
    
    gen_start = time.time()
    generated = pipe(prompt=prompt, image=init_image, strength=0.65, guidance_scale=7.5).images[0]
    log(f"Generation completed in {time.time() - gen_start:.2f} seconds.")
    
    generated.save("workspace/generated_image.png")
    log("Hallucination saved to workspace/generated_image.png")

def extract_depth():
    log("=== JOB 3: EXTRACT DEPTH ===")
    import torch
    from transformers import pipeline
    
    device = 0 if torch.cuda.is_available() else -1
    log(f"Device selected for depth extraction: {'CUDA (0)' if device == 0 else 'CPU (-1)'}")
    
    log("Loading Depth-Anything-V2 Pipeline...")
    start_time = time.time()
    depth_pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device)
    log(f"Depth pipeline loaded in {time.time() - start_time:.2f} seconds.")
    
    log("Loading unaligned generated image...")
    generated_pil = Image.open("workspace/generated_image.png").convert("RGB")
    
    log("Executing depth inference...")
    inf_start = time.time()
    depth_result = depth_pipe(generated_pil)
    log(f"Depth inference completed in {time.time() - inf_start:.2f} seconds.")
    
    depth_array = np.array(depth_result["depth"]).astype(np.float32)
    log(f"Raw Depth Array - Shape: {depth_array.shape}, Min: {depth_array.min():.4f}, Max: {depth_array.max():.4f}, Mean: {depth_array.mean():.4f}")
    
    depth_min, depth_max = depth_array.min(), depth_array.max()
    if depth_min != depth_max:
        normalized_depth = ((depth_array - depth_min) / (depth_max - depth_min) * 255).astype(np.uint8)
    else:
        normalized_depth = np.zeros_like(depth_array, dtype=np.uint8)

    Image.fromarray(normalized_depth).save("workspace/raw_depth_map.png")
    log("Visual depth map saved to workspace/raw_depth_map.png for manual realignment.")

def segment_layers():
    log("=== JOB 4: SEGMENT LAYERS ===")
    file_path = "workspace/cropped_image.png"
    
    layers = int(os.getenv("TARGET_LAYERS", 6))
    log(f"Requested strata count parsed: {layers}")

    log("Loading arrays into memory...")
    source_array = np.array(Image.open(file_path).convert("RGB"))
    
    depth_path = "workspace/realigned_depth_map.png"
    if not os.path.exists(depth_path):
        log(f"FATAL Error: {depth_path} not found. You are required to align raw_depth_map.png manually via the UI first.")
        sys.exit(1)
        
    depth_array = np.array(Image.open(depth_path).convert("L")).astype(np.float32)
    
    log(f"Source Array: {source_array.shape}, Depth Array: {depth_array.shape}")

    if depth_array.shape[:2] != source_array.shape[:2]:
        log("WARNING: Realigned depth map dimensions do not match source. Forcing resize.")
        depth_array = cv2.resize(depth_array, (source_array.shape[1], source_array.shape[0]), interpolation=cv2.INTER_LINEAR)

    min_depth, max_depth = depth_array.min(), depth_array.max()
    log(f"Pre-Normalization - Min Depth: {min_depth:.4f}, Max Depth: {max_depth:.4f}")
    
    if min_depth == max_depth:
        log("WARNING: Depth is entirely flat. Min == Max. Normalization will fail gracefully.")
        normalized_depth = np.zeros_like(depth_array)
    else:
        normalized_depth = np.interp(depth_array, (min_depth, max_depth), (0, 255))
        log("Depth normalized to 0-255 scale.")

    bins = np.linspace(0, 255.1, layers + 1)
    log(f"Calculated depth bins: {bins}")
    
    log("Opening zipfile for packaging...")
    with zipfile.ZipFile("paper_planes_layers.zip", "w", zipfile.ZIP_DEFLATED) as zip_file:
        for i in range(layers):
            layer_mask = (normalized_depth >= bins[i]) & (normalized_depth < bins[i+1])
            active_pixels = np.count_nonzero(layer_mask)
            
            log(f"Layer {i:03d} - Active pixels: {active_pixels}")
            
            if active_pixels > 0:
                layer_rgba = np.zeros((source_array.shape[0], source_array.shape[1], 4), dtype=np.uint8)
                layer_rgba[..., :3] = source_array
                mask_smoothed = cv2.GaussianBlur((layer_mask * 255).astype(np.uint8), (5, 5), 0)
                layer_rgba[..., 3] = mask_smoothed
                
                img_byte_arr = io.BytesIO()
                Image.fromarray(layer_rgba).save(img_byte_arr, format='PNG')
                filename = f"layer_{i:03d}.png"
                zip_file.writestr(filename, img_byte_arr.getvalue())
                log(f"  -> {filename} packaged successfully.")
            else:
                log(f"  -> Layer {i:03d} skipped (empty).")
                
    log("Segmentation complete. Output finalized at paper_planes_layers.zip.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pipeline.py <job_name>")
        sys.exit(1)
        
    job = sys.argv[1]
    if job == "crop": perspective_crop()
    elif job == "generate": generate_image()
    elif job == "depth": extract_depth()
    elif job == "segment": segment_layers()
    else:
        print(f"Unknown job: {job}. I only respond to 'crop', 'generate', 'depth', or 'segment'.")
