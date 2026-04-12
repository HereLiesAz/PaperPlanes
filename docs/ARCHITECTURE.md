# PAPERPLANES: THE DEFINITIVE ARCHITECTURAL SPECIFICATION
## EXHAUSTIVE VISCERA & SYSTEM ONTOLOGY v1.3

### I. THE SMUGGLER (CLOUDFLARE WORKER PROXY)
The Worker acts as a CORS-pacified bridge and a stateless gatekeeper between the browser's mathematical flatland and GitHub's bureaucratic REST API.

1.  **POST: Trigger Sequence (The Injection)**
    * **Metadata Retrieval:** Interrogates the repository for a file's existing `SHA` to permit an update (`PUT`) rather than a collision.
    * **Binary Delivery:** Transmits the `inbox/` image buffer as a Base64 string.
    * **Event Dispatch:** Fires a `repository_dispatch` event to the GitHub API. 
    * **Payload Mapping:** Translates the frontend state into a `client_payload` containing:
        * `job`: {crop, generate, depth, segment}
        * `layers`: Integer (2-12)
        * `coords`: CSV string of 4-point manual vectors.
        * `prompt`: Custom semantic directive for the hallucination engine.

2.  **GET: Artifact Proxy (The Reconstruction)**
    * **Metadata-to-Binary Bridge:** Bypasses GitHub's raw CDN (and its 5-minute 404 cache) by fetching file metadata directly.
    * **On-the-fly Decoding:** Extracts the `content` string, strips newlines, and uses `atob` with `Uint8Array` to serve raw image bytes with a hard-coded `image/png` content-type.
    * **Cache-Busting:** Forces `Cache-Control: no-store` to ensure the browser never serves a ghost.

3.  **GET: Polling Protocol (The State Ledger)**
    * **Inquiry:** Fetches `actions/runs?per_page=1`.
    * **Extraction:** Exposes `run_id`, `status`, and `conclusion` to the frontend state machine.
    * **Sync Logic:** Provides the `run_id` as the primary key for the frontend’s "Object Permanence" gate.

---

### II. THE ORCHESTRATOR (GITHUB ACTION WORKFLOW)
The Action is a serialized, ephemeral container designed to perform compute-heavy deconstruction without polluting the local environment.

1.  **Concurrency Control:**
    * **Group:** `paperplanes-sync`.
    * **Policy:** `cancel-in-progress: false`. 
    * **Purpose:** Prevents repository corruption. If a human spams a "Force Hallucination" trigger, the runners wait in a queue, ensuring Step 2 doesn't overwrite Step 1's commit before it finishes.

2.  **Dependency Stratification:**
    * **Base:** `pillow`, `numpy`, `opencv-python-headless`.
    * **Neural:** `google-generativeai`, `torch`, `diffusers`, `transformers`, `accelerate`.
    * **Optimization:** Dynamic loading logic ensure the "Crop" runner doesn't waste time/RAM loading LLM weights.

3.  **The Rebase-Lock Loop:**
    * **Atomic Push:** Implements `git pull --rebase origin main` immediately prior to pushing.
    * **Logic:** Ensures the runner incorporates any manual human overrides (e.g., a manual crop committed while Step 2 was hallucinating) before finalizing its results.

---

### III. THE EXECUTIONER (PIPELINE.PY)
The Python script is the mathematical heart of the operation, modularized into discrete "Jobs" triggered by the dispatch payload.

1.  **Perspective Module:**
    * **Warp Logic:** Uses `cv2.getPerspectiveTransform` to map a quadrilateral (auto-detected via Canny edges or manual CSV coordinates) to a head-on rectangle. 
    * **Normalization:** All inputs are converted to BGR via OpenCV before transformation.

2.  **Multimodal Module:**
    * **Engine:** Gemini 1.5 Flash (via `google-generativeai`).
    * **Logic:** Ingests the `cropped_image.png` and the user's semantic directive. 
    * **Constraint Enforcement:** "Mister Rogers opening the gate" is treated as non-weighted imagery, preventing its presence from biasing the latent space reconstruction.

3.  **Inference Module:**
    * **Model:** `depth-anything-v2-small-hf`.
    * **Normalization:** Outputs a raw floating-point depth map, normalized to 0-255 grayscale.

4.  **Stratification Module:**
    * **Mathematical Slicing:** Uses `np.linspace` to bin the realigned depth map into discrete strata.
    * **Edge Management:** Applies `GaussianBlur` to the layer masks to prevent the visual tragedy of aliased edges in the final paper theater.

---

### IV. PERSISTENCE & ARTIFACT SCHEMA
* **Inbox:** `/inbox/source_image.png` (The raw input).
* **Workspace:** * `cropped_image.png`: The geometric truth.
    * `generated_image.png`: The semantic hallucination.
    * `raw_depth_map.png`: The neural spatial guess.
    * `realigned_depth_map.png`: The human-corrected spatial truth.
* **Terminal Artifact:** `paper_planes_layers.zip` (The final stratification).

---

### V. SYSTEM REQUIREMENTS & PERMISSIONS
* **Action Permissions:** `contents: write`, `actions: read`.
* **Environmental Secrets:** `GEMINI_API_KEY`, `GH_TOKEN`, `GH_REPO`.
* **UI Aesthetic:** Strict monochromatic "Glitch-Noir". High contrast. No small talk. No regressions.
