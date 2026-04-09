const uploadInput = document.getElementById('upload');
const numLayersInput = document.getElementById('numLayers');
const executeBtn = document.getElementById('executeBtn');
const logContainer = document.getElementById('log-container');
const progressBar = document.getElementById('progressBar');

const CLOUDFLARE_WORKER_URL = 'https://paperplanes.hereliesaz.workers.dev/'; 
const GH_REPO = 'HereLiesAz/PaperPlanes';

function logMsg(msg, type = 'entry') {
    const el = document.createElement('div');
    el.className = `log-${type}`;
    el.innerHTML = `> ${msg}`;
    logContainer.appendChild(el);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function updateProgress(percent) {
    progressBar.value = percent;
}

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
            logMsg("Victim committed. Forcing the API to acknowledge the new timeline...", "success");
            
            await new Promise(r => setTimeout(r, 5000));
            pollForArtifact(GH_REPO);

        } catch (err) {
            updateProgress(0);
            logMsg(`Catastrophe: ${err.message}`, "error");
        }
    };
    reader.readAsDataURL(file);
});

async function pollForArtifact(repo) {
    const maxAttempts = 60; 
    let attempts = 0;
    let activeRunId = null;

    const interval = setInterval(async () => {
        attempts++;
        const percent = 30 + ((attempts / maxAttempts) * 60);
        updateProgress(percent);

        if (attempts > maxAttempts) {
            clearInterval(interval);
            updateProgress(0);
            logMsg("Timeout: The machines took too long.", "error");
            return;
        }

        try {
            // Force the browser to pull fresh data, no caching allowed.
            const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?event=push&per_page=1`, {
                cache: 'no-store'
            });
            const runsData = await runsRes.json();
            
            if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
                const latestRun = runsData.workflow_runs[0];
                
                // If we haven't locked onto the new run yet
                if (!activeRunId) {
                    // Ignore ghosts. If it's already complete, it's an old run.
                    if (latestRun.status === 'completed') {
                        logMsg(`Waiting for GitHub to wake up... (Attempt ${attempts}/${maxAttempts})`);
                        return; 
                    } else {
                        // The new container has spawned. Lock onto it.
                        activeRunId = latestRun.id;
                        logMsg(`Blade is falling (Run ID: ${activeRunId})...`, "highlight");
                    }
                }

                // If we are locked onto the active run, watch it bleed
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
