if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

const terminal = document.getElementById('terminal');
const terminalStatus = document.getElementById('terminalStatus');

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
    slider.addEventListener('input', (e) => display.textContent = e.target.value);
}

// --- PIPELINE WIZARD STATE MACHINE ---
const WORKFLOW = [
    { id: 'crop', title: 'Step 1: Perspective & Crop Validation', output: '/workspace/cropped_image.png' },
    { id: 'generate', title: 'Step 2: AI Hallucination Validation', output: '/workspace/generated_image.png' },
    { id: 'depth', title: 'Step 3: Depth Map Extraction', output: '/workspace/raw_depth_map.png' },
    { id: 'align', title: 'Step 4: Manual Realignment', output: null },
    { id: 'segment', title: 'Step 5: Final Segmentation', output: '/workspace/paper_planes_layers.zip' }
];

let currentStepIdx = 0;
let pollInterval = null;
const proxyUrl = "https://paperplanes.hereliesaz.workers.dev"; 
let base64Payload = null;
let currentFileName = null;

document.getElementById('sourceInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        base64Payload = event.target.result.split(',')[1];
        currentFileName = file.name;
        // Pre-load realigner base
        loadImg(e, baseImg, () => { hasBase = true; drawCanvas(); });
    };
    reader.readAsDataURL(file);
});

document.getElementById('processBtn').addEventListener('click', () => {
    if (!base64Payload) {
        log("FATAL: Source image required.", "error");
        return;
    }
    document.getElementById('init-container').style.display = 'none';
    currentStepIdx = 0;
    executeStep(currentStepIdx);
});

async function executeStep(index) {
    const step = WORKFLOW[index];
    if (!step) return;

    terminalStatus.textContent = `EXECUTING: ${step.id.toUpperCase()}`;
    terminalStatus.style.color = '#ffaa00';
    log(`--- INITIATING: ${step.name} ---`);
    document.getElementById('approval-ui').style.display = 'none';

    if (step.id === 'align') {
        log("Redirecting to Realigner Tab for manual override.", "warn");
        document.querySelector('[data-target="realigner-tab"]').click();
        return;
    }

    try {
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: `inbox/${currentFileName}`,
                content: base64Payload,
                job: step.id,
                layers: document.getElementById('layersInput').value
            })
        });

        if (response.ok) {
            pollInterval = setInterval(() => pollTelemetry(step), 5000);
        } else {
            log(`Proxy HTTP ${response.status}`, "error");
            terminalStatus.textContent = 'NETWORK FAULT';
        }
    } catch (error) {
        log(`Transmission failed: ${error.message}`, "error");
        terminalStatus.textContent = 'OFFLINE';
    }
}

async function pollTelemetry(step) {
    try {
        const response = await fetch(proxyUrl, { method: 'GET' });
        if (!response.ok) return;
        const data = await response.json();
        
        if (data.status === 'completed') {
            clearInterval(pollInterval);
            terminalStatus.textContent = "AWAITING APPROVAL";
            terminalStatus.style.color = '#00ff00';
            log(`${step.name} completed. Awaiting human consent.`, "info");
            
            if (step.id === 'segment') {
                log("Final artifact paper_planes_layers.zip generated. Pipeline terminated.", "info");
                return;
            }

            // Present approval UI
            const outUrl = data.artifacts?.output || step.output;
            document.getElementById('approval-title').textContent = step.title;
            document.getElementById('approval-preview').src = outUrl;
            document.getElementById('approval-ui').style.display = 'block';
            
            // Wire depth map into realigner proactively
            if (step.id === 'depth') {
                depthImg.onload = () => { hasDepth = true; drawCanvas(); };
                depthImg.src = outUrl;
            }
        }
    } catch (error) {
        console.error("Polling error:", error);
    }
}

document.getElementById('btn-approve').addEventListener('click', () => {
    currentStepIdx++;
    executeStep(currentStepIdx);
});

document.getElementById('btn-reject').addEventListener('click', () => {
    log(`Human rejected artifact for ${WORKFLOW[currentStepIdx].name}. Halting.`, "error");
    document.getElementById('approval-ui').style.display = 'none';
    document.getElementById('init-container').style.display = 'block';
});

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

document.getElementById('exportBtn').addEventListener('click', () => {
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

    // In a real flow, this sends realigned_depth_map.png to the proxy. We simulate by downloading and progressing.
    const link = document.createElement('a');
    link.download = 'realigned_depth_map.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    
    log("Manual alignment complete. Returning to pipeline.", "info");
    document.querySelector('[data-target="pipeline-tab"]').click();
    currentStepIdx++;
    executeStep(currentStepIdx);
});
