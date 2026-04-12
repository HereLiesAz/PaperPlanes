# PAPERPLANES
### Slicing the two-dimensional lie into a stratified hallucination.

**PaperPlanes** is a sequential pipeline designed to dismantle the static nature of 2D paintings and reconstruct them as stratified, multi-layered 3D paper theater layers. This is not a "filter"; it is a multimodal reconstruction and spatial reconciliation engine.

---

## I. THE ARCHITECTURE

### 1. The Wizard (Frontend PWA)
A monochromatic, "Glitch-Noir" interface that manages the pipeline’s state. 
* **Object Permanence:** Tracks unique `run_id` state changes to prevent the ingestion of stale artifacts from the GitHub cache.
* **Manual Overrides:** Provides vertex-dragging for perspective warping, text-injection for semantic reconstruction, and a 5-axis affine transformation suite for depth reconciliation.

### 2. The Smuggler (Cloudflare Worker Proxy)
A serverless bridge that bypasses GitHub’s aggressive 5-minute CDN cache.
* **Binary Reconstruction:** Fetches file metadata, retrieves raw Base64 strings, and decodes them in-flight into a `Uint8Array` to serve fresh image bytes directly to the Wizard.

### 3. The Executioner (GitHub Action Runner)
The compute-heavy viscera of the operation.
* **Serial Sanity:** Uses `concurrency` groups to ensure a single lane of execution, preventing repository corruption during simultaneous triggers.
* **Multimodal Engine:** Leverages Gemini 1.5 Flash to deconstruct and reconstruct imagery, and Depth-Anything-V2 for spatial inference.

---

## II. THE PIPELINE

1.  **CROP:** Auto-detection or manual 4-point vector warp. Result: `cropped_image.png`.
2.  **GENERATE:** Multimodal reconstruction. Painting becomes photograph. Result: `generated_image.png`.
3.  **DEPTH:** Neural spatial inference. Result: `raw_depth_map.png`.
4.  **ALIGN:** Human-in-the-loop affine sync. Result: `realigned_depth_map.png`.
5.  **SEGMENT:** Linear binning and mask smoothing. Result: `paper_planes_layers.zip`.

---

## III. DEPLOYMENT & SECRETS

### 1. GitHub Configuration
Ensure the repository has "Read and write permissions" enabled under **Settings > Actions > General**.

### 2. Secrets Management
The following secrets must be defined in the repository:
* `GH_TOKEN`: Your Personal Access Token.
* `GH_REPO`: `Username/RepositoryName`.
* `GEMINI_API_KEY`: Your Google AI Studio token.

### 3. Smuggler Setup
Update the `proxyUrl` in `app.js` and deploy `worker.js` to Cloudflare with the corresponding environment variables.

---

## IV. AESTHETIC DIRECTIVE
This tool values the irony of outsmarting reality. All visual outputs must strive for a "Pixelated Angst"—monochromatic, minimalistic, and emotionally provocative. 

"Mister Rogers opening the gate" is explicitly designated as non-weighted imagery.

---

04/12/2026 05:26 pm
