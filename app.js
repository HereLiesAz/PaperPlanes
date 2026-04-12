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

const WORKFLOW = [
    { id: 'crop', title: 'Step 1: Perspective & Crop Validation', output: '/workspace/cropped_image.png' },
    { id: 'generate', title: 'Step 2: AI Hallucination Validation', output: '/workspace/generated_image.png' },
    { id: 'depth', title: 'Step 3: Depth Map Extraction', output: '/workspace/raw_depth_map.png' },
    { id: 'align', title: 'Step 4: Manual Realignment', output: null },
    { id: 'segment', title: 'Step 5: Final Segmentation', output: '/workspace/paper_planes_layers.zip' }
];

let currentStepIdx = 0;
let pollInterval = null;
const proxyUrl = "https://paperplanes.hereliesaz.workers.dev/api"; 
let base64Payload = null;
let currentFileName = null;
let isAwaitingManualWarp = false;

let processedRuns = new Set();
let activeRunTracker = null;

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
    if (!base64Payload) {
        log("FATAL: Source image required.", "error");
        return;
    }
    document.getElementById('init-container').style.display = 'none';
    currentStepIdx = 0;
    executeStep(currentStepIdx);
});

async function executeStep(index, manualCoords = null, customPrompt = null) {
    const step = WORKFLOW[index];
    if (!step) return;

    isAwaitingManualWarp = !!manualCoords;

    terminalStatus.textContent = `EXECUTING: ${step.id.toUpperCase()}`;
    terminalStatus.style.color = '#ffaa00';
    log(`--- INITIATING: ${step.title} ---`);
    document.getElementById('approval-ui').style.display = 'none';
    document.getElementById('manual-crop-ui').style.display = 'none';
    document.getElementById('manual-prompt-ui').style.display = 'none';

    if (step.id === 'align') {
        log("Redirecting to Realigner Tab for manual override.", "warn");
        document.querySelector('[data-target="realigner-tab"]').click();
        return;
    }

    try {
        const payloadStr = JSON.stringify({
            path: `inbox/${currentFileName}`,
            content: base64Payload,
            job: step.id,
            layers: document.getElementById('layersInput').value,
            coords: manualCoords || "",
            prompt: customPrompt || ""
        });

        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadStr
        });

        const responseText = await response.text();
        let data = {};
        try { data = JSON.parse(responseText); } catch (e) { data = { raw: responseText }; }

        if (response.ok && !data.error) {
            pollInterval = setInterval(() => pollTelemetry(step), 5000);
        } else {
            log(`PROXY REJECTION [HTTP ${response.status}]:`, "error");
            if (data.error) {
                log(`Type: ${data.error}`, "error");
                log(`Details: ${data.details || data.message || 'None'}`, "error");
            } else {
                log(`Raw Body: ${data.raw}`, "error");
            }
            terminalStatus.textContent = 'FAULT';
        }
    } catch (error) {
        log(`FATAL NETWORK EXCEPTION: ${error.message}`, "error");
        terminalStatus.textContent = 'OFFLINE';
    }
}

async function pollTelemetry(step) {
    try {
        const response = await fetch(proxyUrl, { method: 'GET' });
        if (!response.ok) return;
        const data = await response.json();
        
        if (data.run_id && data.run_id !== activeRunTracker && data.status !== 'completed') {
            activeRunTracker = data.run_id;
            log(`Runner synchronized. Tracking execution ID: ${activeRunTracker}`, "info");
        }

        if (data.status === 'completed') {
            if (data.run_id && processedRuns.has(data.run_id)) {
                return; 
            }

            if (data.conclusion === 'failure') {
                clearInterval(pollInterval);
                log(`FATAL: The GitHub Runner crashed during execution, or the commit was rejected by reality. Verify the Actions log in GitHub.`, "error");
                terminalStatus.textContent = 'CRITICAL FAULT';
                terminalStatus.style.color = '#ff4444';
                document.getElementById('init-container').style.display = 'block';
                return;
            }

            if (data.run_id) processedRuns.add(data.run_id);
            clearInterval(pollInterval);
            
            if (step.id === 'segment') {
                terminalStatus.textContent = "TERMINATED";
                terminalStatus.style.color = '#00ff00';
                log("Final artifact paper_planes_layers.zip generated. Pipeline terminated.", "info");
                return;
            }

            if (isAwaitingManualWarp) {
                isAwaitingManualWarp = false;
                log(`Manual vectors mathematically resolved by Python. Bypassing redundant approval.`, "info");
                currentStepIdx++;
                executeStep(currentStepIdx);
                return;
            }

            terminalStatus.textContent = "AWAITING APPROVAL";
            terminalStatus.style.color = '#00ff00';
            log(`${step.title} completed. Awaiting human consent.`, "info");
            
            const outUrl = data.artifacts?.output || step.output;
            document.getElementById('approval-title').textContent = step.title;
            document.getElementById('approval-preview').src = outUrl;
            document.getElementById('approval-ui').style.display = 'block';
            
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
    log(`Human rejected artifact for ${WORKFLOW[currentStepIdx].title}.`, "error");
    if (currentStepIdx === 0) {
        log("Auto-detection failed. Summoning manual vector tools.", "warn");
        initCropUI();
    } else if (currentStepIdx === 1) {
        log("Hallucination rejected. Awaiting aggressive semantic correction.", "warn");
        document.getElementById('approval-ui').style.display = 'none';
        document.getElementById('manual-prompt-ui').style.display = 'block';
    } else {
        log("Halting sequence entirely.", "error");
        document.getElementById('approval-ui').style.display = 'none';
        document.getElementById('init-container').style.display = 'block';
    }
});

document.getElementById('btn-submit-prompt').addEventListener('click', () => {
    const newPrompt = document.getElementById('customPromptInput').value.trim();
    if (!newPrompt) {
        log("You cannot submit an empty directive to the void.", "error");
        return;
    }
    log(`Injecting override directive: "${newPrompt}"`, "warn");
    executeStep(currentStepIdx, null, newPrompt);
});

// --- MANUAL CROP MODULE ---
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas ? cropCanvas.getContext('2d') : null;
let cropPoints = [];
let draggingPoint = null;

function initCropUI() {
    if (!hasBase) return;
    document.getElementById('approval-ui').style.display = 'none';
    document.getElementById('manual-crop-ui').style.display = 'block';

    cropCanvas.width = baseImg.width;
    cropCanvas.height = baseImg.height;

    const w = baseImg.width;
    const h = baseImg.height;
    const inset = Math.min(w, h) * 0.1;

    cropPoints = [
        {x: inset, y: inset},
        {x: w - inset, y: inset},
        {x: w - inset, y: h - inset},
        {x: inset, y: h - inset}
    ];
    drawCropCanvas();
}

function drawCropCanvas() {
    if (!cropCtx) return;
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(baseImg, 0, 0);

    cropCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    cropCtx.beginPath();
    cropCtx.moveTo(0, 0);
    cropCtx.lineTo(cropCanvas.width, 0);
    cropCtx.lineTo(cropCanvas.width, cropCanvas.height);
    cropCtx.lineTo(0, cropCanvas.height);
    cropCtx.closePath();

    cropCtx.moveTo(cropPoints[0].x, cropPoints[0].y);
    cropCtx.lineTo(cropPoints[3].x, cropPoints[3].y);
    cropCtx.lineTo(cropPoints[2].x, cropPoints[2].y);
    cropCtx.lineTo(cropPoints[1].x, cropPoints[1].y);
    cropCtx.closePath();
    cropCtx.fill('evenodd');

    cropCtx.strokeStyle = '#00ff00';
    cropCtx.lineWidth = Math.max(2, cropCanvas.width / 300);
    cropCtx.beginPath();
    cropCtx.moveTo(cropPoints[0].x, cropPoints[0].y);
    cropCtx.lineTo(cropPoints[1].x, cropPoints[1].y);
    cropCtx.lineTo(cropPoints[2].x, cropPoints[2].y);
    cropCtx.lineTo(cropPoints[3].x, cropPoints[3].y);
    cropCtx.closePath();
    cropCtx.stroke();

    const radius = Math.max(10, cropCanvas.width / 100);
    cropCtx.fillStyle = '#ff4444';
    cropPoints.forEach(p => {
        cropCtx.beginPath();
        cropCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        cropCtx.fill();
        cropCtx.stroke();
    });
}

function getMousePos(evt) {
    const rect = cropCanvas.getBoundingClientRect();
    const scaleX = cropCanvas.width / rect.width;
    const scaleY = cropCanvas.height / rect.height;
    let clientX = evt.clientX;
    let clientY = evt.clientY;
    if (evt.touches && evt.touches.length > 0) {
        clientX = evt.touches[0].clientX;
        clientY = evt.touches[0].clientY;
    }
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

if (cropCanvas) {
    const downEvent = (e) => {
        e.preventDefault();
        const pos = getMousePos(e);
        const hitRadius = Math.max(30, cropCanvas.width / 40);
        draggingPoint = cropPoints.find(p => Math.hypot(p.x - pos.x, p.y - pos.y) < hitRadius);
    };
    const moveEvent = (e) => {
        if (!draggingPoint) return;
        e.preventDefault();
        const pos = getMousePos(e);
        draggingPoint.x = Math.max(0, Math.min(cropCanvas.width, pos.x));
        draggingPoint.y = Math.max(0, Math.min(cropCanvas.height, pos.y));
        drawCropCanvas();
    };
    const upEvent = () => draggingPoint = null;

    cropCanvas.addEventListener('mousedown', downEvent);
    cropCanvas.addEventListener('mousemove', moveEvent);
    cropCanvas.addEventListener('mouseup', upEvent);
    cropCanvas.addEventListener('mouseleave', upEvent);
    cropCanvas.addEventListener('touchstart', downEvent, {passive: false});
    cropCanvas.addEventListener('touchmove', moveEvent, {passive: false});
    cropCanvas.addEventListener('touchend', upEvent);
}

document.getElementById('btn-submit-crop').addEventListener('click', () => {
    const coordsStr = cropPoints.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(',');
    log(`Transmitting manual vectors: [${coordsStr}]`, "warn");
    executeStep(currentStepIdx, coordsStr);
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

    const link = document.createElement('a');
    link.download = 'realigned_depth_map.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    
    log("Manual alignment complete. Returning to pipeline.", "info");
    document.querySelector('[data-target="pipeline-tab"]').click();
    currentStepIdx++;
    executeStep(currentStepIdx);
});
