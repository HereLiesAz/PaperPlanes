const terminal = document.getElementById('terminal');
const terminalStatus = document.getElementById('terminalStatus');
let pollInterval = null;

function log(msg, level = 'info') {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const line = document.createElement('div');
    line.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-${level}">${msg}</span>`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

// Polling Engine to fetch live Action telemetry
async function pollTelemetry(proxyUrl) {
    try {
        const response = await fetch(proxyUrl, { method: 'GET' });
        if (!response.ok) return;

        const data = await response.json();
        
        if (data.status === 'completed') {
            clearInterval(pollInterval);
            terminalStatus.textContent = data.conclusion.toUpperCase();
            terminalStatus.style.color = data.conclusion === 'success' ? '#00ff00' : '#ff4444';
            log(`Workflow execution completed with status: ${data.conclusion.toUpperCase()}`, data.conclusion === 'success' ? 'info' : 'error');
            return;
        }

        // Parse jobs and steps
        data.jobs.forEach(job => {
            if (job.status === 'in_progress') {
                const activeStep = job.steps.find(s => s.status === 'in_progress');
                if (activeStep) {
                    // Prevent spamming the exact same step every 5 seconds
                    const msg = `[${job.name}] Executing: ${activeStep.name}...`;
                    if (!terminal.lastChild || !terminal.lastChild.textContent.includes(msg)) {
                        log(msg, "warn");
                    }
                }
            } else if (job.status === 'completed' && job.conclusion === 'failure') {
                const failedStep = job.steps.find(s => s.conclusion === 'failure');
                if (failedStep) {
                    log(`[${job.name}] FAILED at step: ${failedStep.name}`, "error");
                }
            }
        });

    } catch (error) {
        console.error("Polling error:", error);
    }
}

document.getElementById('processBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('sourceInput');
    const layersCount = document.getElementById('layersInput').value;
    const proxyUrl = "https://paperplanes.hereliesaz.workers.dev"; 

    terminal.innerHTML = '';
    if (pollInterval) clearInterval(pollInterval);

    terminalStatus.textContent = 'EXECUTING';
    terminalStatus.style.color = '#ffaa00';
    log("=== INITIATING PAPERPLANES PIPELINE ===");

    if (!fileInput.files.length) {
        log("FATAL: No source image selected.", "error");
        terminalStatus.textContent = 'HALTED';
        terminalStatus.style.color = '#ff4444';
        return;
    }

    const file = fileInput.files[0];
    const newFilename = `original_layers-${layersCount}.${file.name.split('.').pop()}`;
    
    log(`File acquired: ${newFilename}`);

    const reader = new FileReader();
    reader.onload = async function(event) {
        const base64Content = event.target.result.split(',')[1];
        log("Transmitting payload to Cloudflare Proxy...", "warn");

        try {
            const response = await fetch(proxyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: `inbox/${newFilename}`,
                    content: base64Content,
                    message: `Pipeline upload: ${newFilename}`
                })
            });

            if (response.ok) {
                log("=== UPLOAD SUCCESS ===", "info");
                log("Corpse injected into repository. Waking the Cloud Runner...");
                terminalStatus.textContent = 'POLLING TELEMETRY';
                
                // Start polling every 5 seconds
                pollInterval = setInterval(() => pollTelemetry(proxyUrl), 5000);
            } else {
                const errData = await response.text();
                log(`Proxy responded with HTTP ${response.status}: ${errData}`, "error");
                terminalStatus.textContent = 'NETWORK FAULT';
            }
        } catch (error) {
            log(`Network transmission failed: ${error.message}`, "error");
            terminalStatus.textContent = 'OFFLINE';
        }
    };
    reader.readAsDataURL(file);
});
