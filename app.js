/**
 * @file app.js
 * @description Orchestrates the digital slaughter and subsequent 3D resurrection of the user's artwork.
 * We farm out the dirty work to the cloud, then build a mausoleum for the remains.
 */

const numLayersInput = document.getElementById('numLayers');
const uploadInput = document.getElementById('upload');
const executeBtn = document.getElementById('executeBtn');
const loadStrataInput = document.getElementById('loadStrata');
const logContainer = document.getElementById('log-container');
const progressBar = document.getElementById('progressBar');
const stage = document.getElementById('stage');

const CLOUDFLARE_WORKER_URL = 'https://paperplanes.hereliesaz.workers.dev/'; 
const GH_REPO = 'HereLiesAz/PaperPlanes';

let cameraZ = 0;
const Z_STEP_DISTANCE = -800; // The arbitrary gap between slices of reality

/**
 * Appends a sterile decree to the scroll of history.
 * @param {string} msg - The text to log.
 * @param {string} [type='entry'] - The CSS class suffix denoting the emotional weight of the log.
 */
function logMsg(msg, type = 'entry') {
    const el = document.createElement('div');
    el.className = `log-${type}`;
    el.innerHTML = `> ${msg}`;
    logContainer.appendChild(el);
    logContainer.scrollTop = logContainer.scrollHeight;
}

/**
 * Feeds the progress bar its meaningless percentage.
 * @param {number} percent - 0 to 100.
 */
function updateProgress(percent) { progressBar.value = percent; }

executeBtn.addEventListener('click', async () => {
    const file = uploadInput.files[0];
    const layers = parseInt(numLayersInput.value) || 6;

    if (!file) {
        logMsg("Error: Missing victim.", "error");
        return;
    }

    logContainer.innerHTML = '';
    updateProgress(5);
    logMsg(`Encoding victim for ${layers} strata...`, "highlight");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Content = e.target.result.split(',')[1];
        const filename = `victim_${Date.now()}_layers-${layers}.${file.name.split('.').pop()}`;
        const pushTime = Date.now(); 
        
        try {
            updateProgress(15);
            logMsg("Handing victim to the proxy...");
            
            const proxyRes = await fetch(CLOUDFLARE_WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, base64Content })
            });

            if (!proxyRes.ok) throw new Error(await proxyRes.text());

            updateProgress(30);
            logMsg("Victim accepted by proxy. Tracking the slaughterhouse execution...", "success");
            
            await new Promise(r => setTimeout(r, 5000));
            pollForArtifact(GH_REPO, pushTime);
        } catch (err) {
            updateProgress(0);
            logMsg(`Catastrophe: ${err.message}`, "error");
        }
    };
    reader.readAsDataURL(file);
});

/**
 * Stares endlessly into the GitHub Actions abyss until it spits out a corpse.
 * @param {string} repo - The owner/repo string.
 * @param {number} pushTime - Epoch ms of when we threw the file over the wall.
 */
async function pollForArtifact(repo, pushTime) {
    const maxAttempts = 60; 
    let attempts = 0;
    let activeRunId = null;

    const interval = setInterval(async () => {
        attempts++;
        updateProgress(30 + ((attempts / maxAttempts) * 60));

        if (attempts > maxAttempts) {
            clearInterval(interval);
            updateProgress(0);
            logMsg("Timeout: The machines took too long.", "error");
            return;
        }

        try {
            const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/slaughterhouse.yml/runs?per_page=1`, {
                cache: 'no-store'
            });
            const runsData = await runsRes.json();
            
            if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
                const latestRun = runsData.workflow_runs[0];
                const runStartTime = new Date(latestRun.created_at).getTime();
                
                if (!activeRunId) {
                    if (runStartTime < pushTime - 5000) {
                        logMsg(`Waiting for GitHub to wake up... (Attempt ${attempts}/${maxAttempts})`);
                        return; 
                    } else {
                        activeRunId = latestRun.id;
                        logMsg(`Blade is falling (Run ID: ${activeRunId})...`, "highlight");
                    }
                }

                if (latestRun.id === activeRunId) {
                    if (latestRun.status === 'completed') {
                        clearInterval(interval);
                        if (latestRun.conclusion !== 'success') {
                            updateProgress(0);
                            logMsg(`The slaughter failed. Conclusion: ${latestRun.conclusion}`, "error");
                            return;
                        }
                        updateProgress(95);
                        logMsg("Retrieving severed remains...", "highlight");
                        
                        const artifactsRes = await fetch(latestRun.artifacts_url, { cache: 'no-store' });
                        const artifactsData = await artifactsRes.json();
                        
                        if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
                            updateProgress(100);
                            const artifact = artifactsData.artifacts[0];
                            logMsg(`<a href="${latestRun.html_url}" target="_blank">Click here to claim paper_planes_strata.zip from the Run artifacts</a>`, "success");
                        } else {
                            updateProgress(0);
                            logMsg("No artifact found. The void consumed it.", "error");
                        }
                    } else {
                        logMsg(`Executing vivisection... (Status: ${latestRun.status})`);
                    }
                }
            }
        } catch (err) {
            logMsg(`Polling error: ${err.message}`, "error");
        }
    }, 5000);
}

/**
 * Resurrects the severed PNG layers into the 3D theater, stacking them along the Z-axis.
 */
loadStrataInput.addEventListener('change', (e) => {
    // Sort files alphabetically to ensure layer_000, layer_001 order is respected.
    const files = Array.from(e.target.files).sort((a, b) => a.name.localeCompare(b.name));
    if (files.length === 0) return;

    stage.innerHTML = '';
    logMsg(`Resurrecting ${files.length} strata into the void...`, "highlight");

    files.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = url;
        img.className = 'stratum';
        
        // layer_000 (furthest back) gets pushed the deepest. 
        // We reverse the math so the last file in the array is at Z=0 (foreground).
        const depth = (files.length - 1 - index) * Z_STEP_DISTANCE;
        img.style.transform = `translateZ(${depth}px)`;
        
        stage.appendChild(img);
    });

    cameraZ = 0;
    updateCamera();
});

/**
 * Translates the relentless, agonizing churn of the mouse wheel into forward momentum through the hallucinated space.
 */
window.addEventListener('wheel', (e) => {
    // DeltaY dictates speed. Tweak the multiplier if the universe is rushing past too quickly.
    cameraZ += e.deltaY * 3; 
    
    // Prevent retreating out of the theater entirely. The only way out is through.
    if (cameraZ < 0) cameraZ = 0;
    
    updateCamera();
}, { passive: true });

/**
 * Applies the calculated Z-translation to the theater stage, pushing the strata towards the viewport.
 */
function updateCamera() {
    stage.style.transform = `translateZ(${cameraZ}px)`;
}
