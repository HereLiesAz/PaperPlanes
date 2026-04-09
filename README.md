# PaperPlanes

PaperPlanes is an automated image segmentation pipeline. It processes a single 2D source image, generates a depth map using a synthesized 3D representation, and slices the original image into discrete transparent layers.

## Workflow Overview

The pipeline executes via a multi-job GitHub Action to manage computational overhead:

1. **Background Removal:** Isolates the primary subject using `rembg` and generates an alpha mask.
2. **Image Generation:** Uses Stable Diffusion (v1.5) to generate a high-contrast, structural representation of the source image to enhance depth perception.
3. **Alignment:** Uses ORB feature matching and homography to align the generated image precisely with the original source.
4. **Depth Extraction:** Uses `Depth-Anything-V2` to extract a z-axis depth map from the aligned generated image.
5. **Segmentation:** Normalizes the depth map against the isolated subject and slices the original image into the requested number of transparent PNG layers.

## Usage

1. Upload a single source image (`.jpg` or `.png`) to the `inbox/` directory. 
2. The GitHub Action will trigger automatically.
3. Upon completion, the pipeline will commit `paper_planes_layers.zip` to the repository root.

## Dependencies
* `rembg`
* `diffusers`
* `transformers`
* `opencv-python-headless`
* `numpy`
* `Pillow`
