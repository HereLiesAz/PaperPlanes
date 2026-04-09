const terminal = document.getElementById('terminal');
const terminalStatus = document.getElementById('terminalStatus');

function log(msg, level = 'info') {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    
    const line = document.createElement('div');
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${timeStr}]`;
    
    const msgSpan = document.createElement('span');
    msgSpan.className = `log-${level}`;
    msgSpan.textContent = msg;
    
    line.appendChild(timeSpan);
    line.appendChild(msgSpan);
    
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight; // Auto-scroll to bottom
}

document.getElementById('processBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('sourceInput');
    const layersCount = document.getElementById('layersInput').value;

    terminal.innerHTML = ''; // Clear previous logs
    terminalStatus.textContent = 'EXECUTING';
    terminalStatus.style.color = '#ffaa00';

    log("=== INITIATING PAPERPLANES PIPELINE ===");

    if (!fileInput.files.length) {
        log("FATAL: No source image selected in the DOM.", "error");
        terminalStatus.textContent = 'HALTED';
        terminalStatus.style.color = '#ff4444';
        return;
    }

    const file = fileInput.files[0];
    const extension = file.name.split('.').pop();
    const newFilename = `original_layers-${layersCount}.${extension}`;
    
    log(`File acquired: ${file.name}`);
    log(`File size: ${(file.size / 1024 / 1024).toFixed(2)} MB (${file.size} bytes)`);
    log(`MIME Type: ${file.type}`);
    log(`Target Strata Count: ${layersCount}`);
    log(`Compiled internal filename: ${newFilename}`);

    const reader = new FileReader();
    
    reader.onloadstart = () => log("Reading file into memory (Base64 encoding started)...");
    
    reader.onload = async function(event) {
        log("Base64 encoding complete.");
        
        const base64Content = event.target.result.split(',')[1];
        const payloadSize = Math.round(base64Content.length * 0.75); // Estimate original bytes from base64
        
        log(`Base64 string generated. Length: ${base64Content.length} characters.`);
        log(`Constructing JSON payload. Estimated memory footprint: ${(payloadSize / 1024 / 1024).toFixed(2)} MB.`);

        const proxyUrl = "https://paperplanes.hereliesaz.workers.dev"; 
        log(`Targeting Cloudflare Proxy: ${proxyUrl}`);

        try {
            const startTime = performance.now();
            log("Transmitting payload. Awaiting proxy response...", "warn");

            const response = await fetch(proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: `inbox/${newFilename}`,
                    content: base64Content,
                    message: `Pipeline upload: ${newFilename}`
                })
            });

            const endTime = performance.now();
            log(`Network roundtrip completed in ${(endTime - startTime).toFixed(2)}ms.`);

            if (response.ok) {
                const responseData = await response.json();
                log(`Proxy responded with HTTP ${response.status} (OK).`, "info");
                log(`GitHub SHA: ${responseData.content ? responseData.content.sha : 'Unknown'}`);
                log("=== UPLOAD SUCCESS ===", "info");
                log("The file has been committed to the repository inbox.");
                log("The GitHub Action runner is now executing in the cloud.");
                
                terminalStatus.textContent = 'CLOUD EXECUTING';
                terminalStatus.style.color = '#00ff00';
            } else {
                const errData = await response.text();
                log(`Proxy responded with HTTP ${response.status} (Error).`, "error");
                log(`Server trace: ${errData}`, "error");
                terminalStatus.textContent = 'NETWORK FAULT';
                terminalStatus.style.color = '#ff4444';
            }
        } catch (error) {
            log(`Network transmission failed: ${error.message}`, "error");
            terminalStatus.textContent = 'OFFLINE';
            terminalStatus.style.color = '#ff4444';
        }
    };

    reader.onerror = () => {
        log("FATAL: FileReader encountered an error reading the local file.", "error");
        terminalStatus.textContent = 'I/O FAULT';
        terminalStatus.style.color = '#ff4444';
    };

    reader.readAsDataURL(file);
});
