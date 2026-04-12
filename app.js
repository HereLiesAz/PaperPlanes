if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => b.classList.remove('active'));
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

const WORKFLOW = [
    { id: 'crop', title: 'Step 1: Perspective & Crop Validation', output: '/workspace/cropped_image.png', artKey: 'output' },
    { id: 'generate', title: 'Step 2: AI Hallucination Validation', output: '/workspace/generated_image.png', artKey: 'photo' },
    { id: 'depth', title: 'Step 3: Depth Map Extraction', output: '/workspace/raw_depth_map.png', artKey: 'depth' },
    { id: 'align', title: 'Step 4: Manual Realignment', output: null, artKey: null },
    { id: 'segment', title: 'Step 5: Final Segmentation', output: '/workspace/paper_planes_layers.zip', artKey: null }
];

let currentStepIdx = 0;
let pollInterval = null;
const proxyUrl = "https://paperplanes.hereliesaz.workers.dev/api"; 
let base64Payload = null;
let currentFileName = null;
let isAwaitingManualWarp = false;

// Temporal Sync State
let lastKnownRunId = null;
let awaitingNewRun = false;

document.getElementById('sourceInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        base64Payload = event.target.result.split(',')[1];
        currentFileName = file.name;
        loadImg(e, baseImg, () => { hasBase = true; drawCanvas(); });
    };
    reader.readAsDataURL(file);
});

document.getElementById('processBtn').addEventListener('click', () => {
    if (!base64Payload) return log("FATAL: Source image required.", "error");
    document.getElementById('init-container').style.display = 'none';
    currentStepIdx = 0;
    executeStep(currentStepIdx);
});

async function executeStep(index, manualCoords = null, customPrompt = null) {
    const step = WORKFLOW[index];
    if (!step) return;

    isAwaitingManualWarp = !!manualCoords;
    terminalStatus.textContent = `INITIATING: ${step.id.toUpperCase()}`;
    terminalStatus.style.color = '#ffaa00';
    log(`--- TRIGGERING: ${step.title} ---`);
    
    // De-render old artifacts to prevent ghosting
    document.getElementById('approval-ui').style.display = 'none';
    document.getElementById('manual-crop-ui').style.display = 'none';
    document.getElementById('manual-prompt-ui').style.display = 'none';

    try {
        // 1. Snapshot the current Run ID before triggering the next one
        const preRes = await fetch(proxyUrl);
        const preData = await preRes.json();
        lastKnownRunId = preData.run_id;
        awaitingNewRun = true;
        log(`Current GitHub State ID: ${lastKnownRunId}. Awaiting runner birth...`);

        // 2. Trigger the job
        const payloadStr = JSON.stringify({
            path: `inbox/${currentFileName}`,
            content: base64Payload,
            job: step.id,
            layers: document.getElementById('layersInput').value,
            coords: manualCoords || "",
            prompt: customPrompt || ""
        });

        await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadStr
        });

        pollInterval = setInterval(() => pollTelemetry(step), 5000);
    } catch (error) {
        log(`TRIGGER ERROR: ${error.message}`, "error");
    }
}

async function pollTelemetry(step) {
    try {
        const response = await fetch(proxyUrl, { method: 'GET' });
        if (!response.ok) return;
        const data = await response.json();
        
        // Phase 1: Wait for a brand new Run ID to appear in GitHub's API
        if (awaitingNewRun) {
            if (data.run_id !== lastKnownRunId) {
                awaitingNewRun = false;
                log(`NEW RUN DETECTED: ${data.run_id}. Installing dependencies/computing...`, "warn");
            } else {
                terminalStatus.textContent = "WAKING RUNNER...";
                return; // Keep waiting for the API to reflect the dispatch
            }
        }

        // Phase 2: Track the active run
        terminalStatus.textContent = `RUNNING: ${data.status.toUpperCase()}`;
        
        if (data.status === 'completed') {
            clearInterval(pollInterval);
            
            if (data.conclusion === 'failure') {
                log(`RUNNER CRASHED. Check GitHub Actions console.`, "error");
                terminalStatus.textContent = 'FAULT';
                return;
            }

            log(`${step.title} SUCCESS.`, "info");
            
            if (step.id === 'segment') {
                terminalStatus.textContent = "DONE";
                log("Final artifact paper_planes_layers.zip generated.", "info");
                return;
            }

            if (isAwaitingManualWarp) {
                isAwaitingManualWarp = false;
                currentStepIdx++;
                executeStep(currentStepIdx);
                return;
            }

            const outUrl = data.artifacts?.[step.artKey];
            document.getElementById('approval-title').textContent = step.title;
            document.getElementById('approval-preview').src = outUrl;
            document.getElementById('approval-ui').style.display = 'block';
            
            if (step.id === 'depth') {
                depthImg.onload = () => { hasBase = true; hasDepth = true; drawCanvas(); };
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
    if (currentStepIdx === 0) {
        initCropUI();
    } else if (currentStepIdx === 1) {
        document.getElementById('approval-ui').style.display = 'none';
        document.getElementById('manual-prompt-ui').style.display = 'block';
    } else {
        document.getElementById('approval-ui').style.display = 'none';
        document.getElementById('init-container').style.display = 'block';
    }
});

document.getElementById('btn-submit-prompt').addEventListener('click', () => {
    const newPrompt = document.getElementById('customPromptInput').value.trim();
    if (!newPrompt) return;
    executeStep(currentStepIdx, null, newPrompt);
});

// --- REALIGNER & CROP MODULES (UNCHANGED LOGIC) ---
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas ? cropCanvas.getContext('2d') : null;
let cropPoints = [];
let draggingPoint = null;

function initCropUI() {
    document.getElementById('approval-ui').style.display = 'none';
    document.getElementById('manual-crop-ui').style.display = 'block';
    cropCanvas.width = baseImg.width;
    cropCanvas.height = baseImg.height;
    const inset = Math.min(baseImg.width, baseImg.height) * 0.1;
    cropPoints = [
        {x: inset, y: inset},
        {x: baseImg.width - inset, y: inset},
        {x: baseImg.width - inset, y: baseImg.height - inset},
        {x: inset, y: baseImg.height - inset}
    ];
    drawCropCanvas();
}

function drawCropCanvas() {
    if (!cropCtx) return;
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(baseImg, 0, 0);
    cropCtx.strokeStyle = '#00ff00';
    cropCtx.lineWidth = 2;
    cropCtx.beginPath();
    cropCtx.moveTo(cropPoints[0].x, cropPoints[0].y);
    cropPoints.forEach(p => cropCtx.lineTo(p.x, p.y));
    cropCtx.closePath();
    cropCtx.stroke();
    cropCtx.fillStyle = '#ff4444';
    cropPoints.forEach(p => {
        cropCtx.beginPath();
        cropCtx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        cropCtx.fill();
    });
}

function getMousePos(evt) {
    const rect = cropCanvas.getBoundingClientRect();
    const scaleX = cropCanvas.width / rect.width;
    const scaleY = cropCanvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
    };
}

if (cropCanvas) {
    cropCanvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        draggingPoint = cropPoints.find(p => Math.hypot(p.x - pos.x, p.y - pos.y) < 20);
    });
    cropCanvas.addEventListener('mousemove', (e) => {
        if (!draggingPoint) return;
        const pos = getMousePos(e);
        draggingPoint.x = pos.x;
        draggingPoint.y = pos.y;
        drawCropCanvas();
    });
    cropCanvas.addEventListener('mouseup', () => draggingPoint = null);
}

document.getElementById('btn-submit-crop').addEventListener('click', () => {
    const coordsStr = cropPoints.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(',');
    executeStep(currentStepIdx, coordsStr);
});

const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let baseImg = new Image(), depthImg = new Image();
let hasBase = false, hasDepth = false;

const ui = ['x', 'y', 'scale', 'rot', 'op'].reduce((acc, id) => {
    const el = document.getElementById(id);
    if (el) {
        acc[id] = el;
        el.addEventListener('input', () => {
            const valEl = document.getElementById(id + 'Val');
            if (valEl) valEl.innerText = el.value;
            drawCanvas();
        });
    }
    return acc;
}, {});

function drawCanvas() {
    if (!hasBase || !ctx) return;
    canvas.width = baseImg.width;
    canvas.height = baseImg.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImg, 0, 0);
    if (hasDepth) {
        ctx.save();
        ctx.globalAlpha = ui.op.value / 100;
        ctx.translate(canvas.width / 2 + parseInt(ui.x.value), canvas.height / 2 + parseInt(ui.y.value));
        ctx.rotate(parseInt(ui.rot.value) * Math.PI / 180);
        const s = parseInt(ui.scale.value) / 100;
        ctx.scale(s, s);
        ctx.drawImage(depthImg, -depthImg.width / 2, -depthImg.height / 2);
        ctx.restore();
    }
}

document.getElementById('exportBtn').addEventListener('click', () => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = baseImg.width;
    exportCanvas.height = baseImg.height;
    const eCtx = exportCanvas.getContext('2d');
    eCtx.translate(exportCanvas.width / 2 + parseInt(ui.x.value), exportCanvas.height / 2 + parseInt(ui.y.value));
    eCtx.rotate(parseInt(ui.rot.value) * Math.PI / 180);
    const s = parseInt(ui.scale.value) / 100;
    eCtx.scale(s, s);
    eCtx.drawImage(depthImg, -depthImg.width / 2, -depthImg.height / 2);
    
    const link = document.createElement('a');
    link.download = 'realigned_depth_map.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    
    document.querySelector('[data-target="pipeline-tab"]').click();
    currentStepIdx++;
    executeStep(currentStepIdx);
});

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
