// --- PWA Initialization ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log("Service Worker Registered"))
        .catch(err => console.error("Service Worker Failed", err));
}

// --- Tab Navigation ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// --- PIPELINE MODULE ---
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

const slider = document.getElementById('layersInput');
const display = document.getElementById('layerDisplay');
if (slider && display) {
    slider.addEventListener('input', (e) => {
        display.textContent = e.target.value;
    });
}

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

        data.jobs.forEach(job => {
            if (job.status === 'in_progress') {
                const activeStep = job.steps.find(s => s.status === 'in_progress');
                if (activeStep) {
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

const processBtn = document.getElementById('processBtn');
if (processBtn) {
    processBtn.addEventListener('click', async () => {
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
}

// --- REALIGNER MODULE ---
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let baseImg = new Image(), depthImg = new Image();
let hasBase = false, hasDepth = false;

const ui = ['x', 'y', 'scale', 'rot', 'op'].reduce((acc, id) => {
    const el = document.getElementById(id);
    if (el) {
        acc[id] = el;
        el.addEventListener('input', (e) => {
            const valEl = document.getElementById(id + 'Val');
            if (valEl) valEl.innerText = e.target.value;
            drawCanvas();
        });
    }
    return acc;
}, {});

const baseUpload = document.getElementById('baseUpload');
const depthUpload = document.getElementById('depthUpload');

if (baseUpload) baseUpload.onchange = e => loadImg(e, baseImg, () => hasBase = true);
if (depthUpload) depthUpload.onchange = e => loadImg(e, depthImg, () => hasDepth = true);

function loadImg(e, imgObj, callback) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
        imgObj.onload = () => { callback(); drawCanvas(); };
        imgObj.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function drawCanvas() {
    if (!hasBase || !ctx) return;
    
    canvas.width = baseImg.width;
    canvas.height = baseImg.height;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
    ctx.drawImage(baseImg, 0, 0);

    if (hasDepth) {
        ctx.save();
        ctx.globalAlpha = ui.op.value / 100;

        const dx = parseInt(ui.x.value);
        const dy = parseInt(ui.y.value);
        const scale = parseInt(ui.scale.value) / 100;
        const rot = parseInt(ui.rot.value) * Math.PI / 180;

        ctx.translate(canvas.width / 2 + dx, canvas.height / 2 + dy);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        ctx.drawImage(depthImg, -depthImg.width / 2, -depthImg.height / 2);
        ctx.restore();
    }
}

const exportBtn = document.getElementById('exportBtn');
if (exportBtn) {
    exportBtn.onclick = () => {
        if (!hasBase || !hasDepth) return alert('Load both images first.');
        
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = baseImg.width;
        exportCanvas.height = baseImg.height;
        const eCtx = exportCanvas.getContext('2d');
        
        eCtx.save();
        const dx = parseInt(ui.x.value);
        const dy = parseInt(ui.y.value);
        const scale = parseInt(ui.scale.value) / 100;
        const rot = parseInt(ui.rot.value) * Math.PI / 180;

        eCtx.translate(exportCanvas.width / 2 + dx, exportCanvas.height / 2 + dy);
        eCtx.rotate(rot);
        eCtx.scale(scale, scale);
        eCtx.drawImage(depthImg, -depthImg.width / 2, -depthImg.height / 2);
        eCtx.restore();

        const link = document.createElement('a');
        link.download = 'realigned_depth_map.png';
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    };
}
