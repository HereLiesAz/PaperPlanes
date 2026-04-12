# PaperPlanes

PaperPlanes is an automated image segmentation and depth-extraction pipeline designed for execution in Google Colab. It processes 2D source images, synthesizes a structural representation to enhance depth perception, and slices the original image into discrete, transparent Z-axis layers.

## Pipeline Steps

The script executes a strict five-phase process on each provided image:

1. **Phase 1: Background Removal**
   The pipeline utilizes `rembg` to isolate the primary subject from the background, generating an alpha mask that bounds all subsequent topological calculations.

2. **Phase 2: Structural Generation**
   Using `Stable Diffusion v1.5` (img2img) with a high modification strength, the script reimagines the isolated 2D subject as a hyper-realistic, physically lit photograph. This step removes original medium artifacts (such as canvas textures, brushstrokes, or flat lighting) that typically confuse depth-estimation models.

3. **Phase 3: Image Alignment**
   The generated structural image is mapped back to the original image using OpenCV's ORB feature detection and homography mapping. This warps the newly generated geometry so that it perfectly aligns with the pixel coordinates of the original source subject.

4. **Phase 4: Depth Extraction**
   Using `Depth-Anything-V2`, the pipeline infers a highly detailed Z-axis depth map from the structurally aligned generated image.

5. **Phase 5: Strata Segmentation**
   The depth map is normalized on a 0-255 scale strictly within the boundaries of the subject mask. Based on the requested layer count, the pipeline calculates topological thresholds and slices the *original* image into discrete, transparent PNG layers.

## Execution Features

* **Google Drive Integration:** All processed strata are automatically packaged into ZIP files and saved persistently to a designated folder in your Google Drive (`/MyDrive/PaperPlanes_Autopsy`).
* **Batch Processing:** Supports uploading multiple files simultaneously through the Colab web interface.
* **Validation & Deduplication:** The script automatically filters out non-image files and utilizes MD5 hashing to prevent the redundant processing of duplicate files within the same session.

## Usage

1. Open the script in a Google Colab environment with a GPU runtime enabled (T4 or higher).
2. Install the necessary dependencies in the first execution block.
3. Run the main script block. You will be prompted to authenticate with Google Drive to establish the output directory.
4. Use the generated upload widget to provide your source images. The pipeline will process each image sequentially and commit the ZIP files to your Drive.

## Dependencies

~~~text
rembg[gpu]
torch
diffusers
transformers
accelerate
opencv-python-headless
pillow
numpy
requests
~~~
