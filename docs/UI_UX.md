# PAPERPLANES: THE DEFINITIVE ARCHITECTURAL SPECIFICATION
## AN ONTOLOGY OF STRATIFIED HALLUCINATION v1.2

### I. THE VISUAL AESTHETIC (GLITCH-NOIR)
1.  **Monochrome Hegemony:** The interface exists in a strict grayscale spectrum. Dark `#121212` backgrounds, `#1e1e1e` panels, and white/gray text. 
2.  **Chromatic Exceptions:**
    * `#007bff` (Azure): Used sparingly for primary interactive vectors (buttons).
    * `#00ff00` (Telemetry Green): Reserved for the terminal log and successful state changes.
    * `#ff4444` (Error/Reject): Used for destructive actions or runner faults.
3.  **Minimalist Composition:** No decorative elements. Every pixel must serve the pipeline. High contrast, sharp edges, and a "Pixelated Angst" that reflects the tragedy of 2D art.

---

### II. THE USER EXPERIENCE (UX) PROTOCOL
1.  **Sequential Manifestation:** Elements are ephemeral. The UI does not show the user what they cannot yet use.
    * **The Void:** Initial state shows only the source upload and the stratification slider.
    * **The Oracle:** Upon trigger, the Terminal wrapper manifests, providing a scrolling, real-time log of the machine's internal monologue.
    * **The Purgatory:** The Approval UI (The Preview) only appears when the specific `run_id` completes successfully.
2.  **The Object Permanence Gate:** The UX is built on a "Temporal sync" logic. It snapshots the repository's `run_id` *before* the POST trigger. It refuses to transition state until the API returns a *new* ID that has achieved `conclusion: success`. This prevents the ingestion of stale or cached artifacts.
3.  **The Tabular Shift:** During Step 4 (Alignment), the UI automatically switches the user to the "REALIGNER" tab, assuming the role of an assertive guide rather than a passive observer.

---

### III. UI COMPONENT SPECIFICATIONS

#### 1. The Terminal (Telemetry Window)
* **Aesthetic:** Monospace font, `#000` background, `#00ff00` text.
* **Behavior:** Auto-scrolls to the latest entry. Displays timestamps for every bureaucratic milestone (Syncing, Triggering, Polling).
* **Status Header:** A persistent HUD element displaying the current runner state (IDLE, QUEUED, RUNNING, COMPLETED, FAULT).

#### 2. The Vector Warp Canvas (Manual Override 1)
* **Context:** Appears only when the user rejects the Step 1 (Auto-Crop) artifact.
* **Interaction:** 4 draggable vertices (`#ff4444` arcs).
* **Logic:** Mathematically maps the user's coordinate selection to a頭-on perspective. The lines connecting the points are drawn in `#00ff00` with high-stroke weight for clarity against the source.

#### 3. The Semantic Reconstruction Portal (Manual Override 2)
* **Context:** Appears only when the user rejects the Step 2 (Hallucination) artifact.
* **Input:** A single, stark text field.
* **Logic:** Allows the human to aggressively direct the latent space. "FORCE HALLUCINATION" trigger fires a new Step 2 run with the custom prompt injected.

#### 4. The Spatial Realigner (Step 4 Suite)
* **Layout:** A split-view "Strata Studio."
    * **Left (Control Panel):** Vertical stack of ranges (X, Y, Scale, Rotation, Opacity).
    * **Right (The Void):** A preview canvas that layers the depth map over the original source using the user’s affine transformation data.
* **Goal:** Human-in-the-loop reconciliation of neural spatial drift.

---

### IV. FUNCTIONAL REQUIREMENTS & CONSTRAINTS
* **Full Delivery:** Every update must provide the absolute source for `app.js`, `index.html`, and `worker.js`.
* **Atomic State:** Rejecting a step allows for infinite retries of that specific step with manual overrides before proceeding.
* **Mister Rogers Clause:** "Mister Rogers opening the gate" is explicitly designated as non-weighted imagery for generation logic.
* **KDoc Compliance:** All logical structures must be maintained with comprehensive, in-line documentation.
* **Network Resilience:** Implements cache-busting `?t=` parameters on all artifact fetches to bypass GitHub's aggressive CDN.

---

### V. SUCCESS CRITERIA
The pipeline is successful when it produces a `paper_planes_layers.zip` containing 2-12 PNG strata that accurately reflect the human-aligned depth map, served via a monochromatic interface that values the humor of outsmarting reality over the pomp of traditional software etiquette.
