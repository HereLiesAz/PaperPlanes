const uploadInput = document.getElementById('upload');
const executeBtn = document.getElementById('executeBtn');
const logContainer = document.getElementById('log-container');
const progressBar = document.getElementById('progressBar');

const CLOUDFLARE_WORKER_URL = 'https://paperplanes.hereliesaz.workers.dev/'; 
const GH_REPO = 'HereLiesAz/paper-planes';

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

    if (!file) {
        logMsg("Error: Missing victim.", "error");
        return;
    }

    logContainer.innerHTML = '';
    updateProgress(5);
    logMsg("Encoding victim...", "highlight");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Content = e.target.result.split(',')[1];
        const filename = `victim_${Date.now()}.${file.name.split('.').pop()}`;
        
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
            logMsg("Victim committed. Polling public Actions API for execution...", "success");
            
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
            logMsg(`Listening for the blade... (Attempt ${attempts}/${maxAttempts})`);
            
            const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?event=push&per_page=1`);
            const runsData = await runsRes.json();
            
            if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
                const latestRun = runsData.workflow_runs[0];
                
                if (latestRun.status === 'completed') {
                    clearInterval(interval);
                    
                    if (latestRun.conclusion !== 'success') {
                        updateProgress(0);
                        logMsg(`The slaughter failed. Conclusion: ${latestRun.conclusion}`, "error");
                        return;
                    }

                    updateProgress(95);
                    logMsg("Retrieving severed remains...", "highlight");
                    
                    const artifactsRes = await fetch(latestRun.artifacts_url);
                    const artifactsData = await artifactsRes.json();
                    
                    if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
                        updateProgress(100);
                        const artifact = artifactsData.artifacts[0];
                        logMsg(`<a href="${latestRun.html_url}" target="_blank">Click here to claim paper_planes_strata.zip from the Run artifacts</a>`, "success");
                    } else {
                        updateProgress(0);
                        logMsg("No artifact found. The void consumed it.", "error");
                    }
                }
            }
        } catch (err) {
            logMsg(`Polling error: ${err.message}`, "error");
        }
    }, 5000);
}
