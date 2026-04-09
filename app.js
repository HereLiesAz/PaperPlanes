const tokenInput = document.getElementById('ghToken');
const repoInput = document.getElementById('ghRepo');
const uploadInput = document.getElementById('upload');
const executeBtn = document.getElementById('executeBtn');
const statusDiv = document.getElementById('status');

// Remember the keys to the kingdom
tokenInput.value = localStorage.getItem('ghToken') || '';
repoInput.value = localStorage.getItem('ghRepo') || '';

tokenInput.addEventListener('change', () => localStorage.setItem('ghToken', tokenInput.value));
repoInput.addEventListener('change', () => localStorage.setItem('ghRepo', repoInput.value));

executeBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();
    const file = uploadInput.files[0];

    if (!token || !repo || !file) {
        statusDiv.innerText = "Error: Missing token, repo, or file.";
        return;
    }

    statusDiv.innerText = "Encoding victim...";
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        // Strip the data:image/png;base64, header
        const base64Content = e.target.result.split(',')[1];
        const filename = `inbox/victim_${Date.now()}.${file.name.split('.').pop()}`;
        
        try {
            statusDiv.innerText = "Committing victim to inbox...";
            const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Pushing victim to slaughterhouse`,
                    content: base64Content
                })
            });

            if (!putRes.ok) throw new Error(`Commit failed: ${putRes.statusText}`);

            statusDiv.innerText = "Victim committed. Polling Actions API for execution...";
            
            // Wait a moment for the webhook to trigger the action
            await new Promise(r => setTimeout(r, 5000));
            
            pollForArtifact(repo, token);

        } catch (err) {
            statusDiv.innerText = `Catastrophe: ${err.message}`;
        }
    };
    reader.readAsDataURL(file);
});

async function pollForArtifact(repo, token) {
    const maxAttempts = 60; // 5 minutes max
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
            
            // Fetch latest workflow runs
            const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?event=push&per_page=1`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
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
                    
                    const artifactsRes = await fetch(latestRun.artifacts_url, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const artifactsData = await artifactsRes.json();
                    
                    if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
                        const artifact = artifactsData.artifacts[0];
                        // Artifact download requires following a redirect with the auth token
                        statusDiv.innerHTML = `<a href="https://github.com/${repo}/actions/runs/${latestRun.id}/artifacts/${artifact.id}" target="_blank" style="color:#0f0;">Click here to claim paper_planes_strata.zip</a>`;
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
