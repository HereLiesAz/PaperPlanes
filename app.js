const uploadInput = document.getElementById('upload');
const executeBtn = document.getElementById('executeBtn');
const statusDiv = document.getElementById('status');

// Point this to your new serverless tollbooth
const CLOUDFLARE_WORKER_URL = 'https://paperplanes.hereliesaz.workers.dev/'; 
const GH_REPO = 'HereLiesAz/paperplanes';

executeBtn.addEventListener('click', async () => {
    const file = uploadInput.files[0];

    if (!file) {
        statusDiv.innerText = "Error: Missing victim.";
        return;
    }

    statusDiv.innerText = "Encoding victim...";
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Content = e.target.result.split(',')[1];
        const filename = `victim_${Date.now()}.${file.name.split('.').pop()}`;
        
        try {
            statusDiv.innerText = "Handing victim to the proxy...";
            
            // The browser talks to Cloudflare, Cloudflare talks to GitHub.
            const proxyRes = await fetch(CLOUDFLARE_WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, base64Content })
            });

            if (!proxyRes.ok) throw new Error(await proxyRes.text());

            statusDiv.innerText = "Victim committed. Polling public Actions API for execution...";
            
            await new Promise(r => setTimeout(r, 5000));
            
            // Note: The PWA can poll the public runs/artifacts API without a token 
            // ONLY IF the repository is completely public.
            pollForArtifact(GH_REPO);

        } catch (err) {
            statusDiv.innerText = `Catastrophe: ${err.message}`;
        }
    };
    reader.readAsDataURL(file);
});

async function pollForArtifact(repo) {
    const maxAttempts = 60; 
    let attempts = 0;

    const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(interval);
            statusDiv.innerText = "Timeout: The machines took too long.";
            return;
        }

        try {
            statusDiv.innerText = `Listening for the blade... (Attempt ${attempts}/60)`;
            
            // Fetching public workflow runs doesn't require auth
            const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?event=push&per_page=1`);
            const runsData = await runsRes.json();
            
            if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
                const latestRun = runsData.workflow_runs[0];
                
                if (latestRun.status === 'completed') {
                    clearInterval(interval);
                    
                    if (latestRun.conclusion !== 'success') {
                        statusDiv.innerText = `The slaughter failed. Conclusion: ${latestRun.conclusion}`;
                        return;
                    }

                    statusDiv.innerText = "Retrieving severed remains...";
                    
                    const artifactsRes = await fetch(latestRun.artifacts_url);
                    const artifactsData = await artifactsRes.json();
                    
                    if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
                        const artifact = artifactsData.artifacts[0];
                        // Downloading public artifacts from the API requires jumping through hoops.
                        // It is easier to point the user directly to the run page.
                        statusDiv.innerHTML = `<a href="${latestRun.html_url}" target="_blank" style="color:#0f0;">Click here to claim paper_planes_strata.zip from the Run artifacts</a>`;
                    } else {
                        statusDiv.innerText = "No artifact found. The void consumed it.";
                    }
                }
            }
        } catch (err) {
            console.error(err);
        }
    }, 5000);
}
