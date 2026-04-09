const tokenInput = document.getElementById('ghToken');
const repoInput = document.getElementById('ghRepo');
const numLayersInput = document.getElementById('numLayers');
const uploadInput = document.getElementById('upload');
const executeBtn = document.getElementById('executeBtn');
const logContainer = document.getElementById('log-container');
const progressBar = document.getElementById('progressBar');

tokenInput.value = localStorage.getItem('ghToken') || '';
repoInput.value = localStorage.getItem('ghRepo') || '';

tokenInput.addEventListener('change', () => localStorage.setItem('ghToken', tokenInput.value.trim()));
repoInput.addEventListener('change', () => localStorage.setItem('ghRepo', repoInput.value.trim()));

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
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();
    const file = uploadInput.files[0];
    const layers = parseInt(numLayersInput.value) || 6;

    if (!token || !repo || !file) {
        logMsg("Error: Missing token, repository, or victim.", "error");
        return;
    }

    logContainer.innerHTML = '';
    updateProgress(5);
    logMsg(`Encoding victim for ${layers} strata...`, "highlight");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Content = e.target.result.split(',')[1];
        const filename = `inbox/victim_${Date.now()}_layers-${layers}.${file.name.split('.').pop()}`;
        
        const pushTime = Date.now(); 
        
        try {
            updateProgress(15);
            logMsg("Committing victim directly to the slaughterhouse...");
            
            const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Pushing victim for vivisection`,
                    content: base64Content
                })
            });

            if (!putRes.ok) throw new Error(`Commit failed: ${putRes.statusText}`);

            updateProgress(30);
            logMsg("Victim committed. Tracking the execution...", "success");
            
            await new Promise(r => setTimeout(r, 5000));
            pollForArtifact(repo, token, pushTime);

        } catch (err) {
            updateProgress(0);
            logMsg(`Catastrophe: ${err.message}`, "error");
        }
    };
    reader.readAsDataURL(file);
});

async function pollForArtifact(repo, token, pushTime) {
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
            // Explicitly scope the query to ONLY the slaughterhouse workflow, breaking the cache
            const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/slaughterhouse.yml/runs?per_page=1`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-store'
            });
            const runsData = await runsRes.json();
            
            if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
                const latestRun = runsData.workflow_runs[0];
                const runStartTime = new Date(latestRun.created_at).getTime();
                
                if (!activeRunId) {
                    // Ignore old ghosts
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
                        
                        const artifactsRes = await fetch(latestRun.artifacts_url, { 
                            headers: { 'Authorization': `Bearer ${token}` },
                            cache: 'no-store' 
                        });
                        const artifactsData = await artifactsRes.json();
                        
                        if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
                            updateProgress(100);
                            const artifact = artifactsData.artifacts[0];
                            logMsg(`<a href="https://github.com/${repo}/actions/runs/${latestRun.id}/artifacts/${artifact.id}" target="_blank">Click here to claim paper_planes_strata.zip</a>`, "success");
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
