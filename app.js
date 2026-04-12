if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

// UI State Management
const hide = (id) => document.getElementById(id).style.display = 'none';
const show = (id, flex = false) => document.getElementById(id).style.display = flex ? 'flex' : 'block';

// Tab Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        show(btn.dataset.target, true);
    });
});

const terminal = document.getElementById('terminal');
const terminalStatus = document.getElementById('terminalStatus');

function log(msg, level = 'info') {
    const line = document.createElement('div');
    const time = new Date().toTimeString().split(' ')[0];
    line.innerHTML = `<span style="color:#666">[${time}]</span> <span class="log-${level}">${msg}</span>`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

const layersInput = document.getElementById('layersInput');
const layerDisplay = document.getElementById('layerDisplay');
if (layersInput) layersInput.oninput = (e) => layerDisplay.textContent = e.target.value;

// Pipeline Constants
const WORKFLOW = [
    { id: 'crop', title: 'Step 1: Perspective', key: 'output' },
    { id: 'generate', title: 'Step 2: Generation', key: 'photo' },
    { id: 'depth', title: 'Step 3: Depth Extraction', key: 'depth' },
    { id: 'align', title: 'Step 4: Realignment', key: null },
    { id: 'segment', title: 'Step 5: Segmentation', key: null }
];

let currentStepIdx = 0;
let pollInterval = null;
const proxyUrl = "https://paperplanes.hereliesaz.workers.dev/api"; 
let base64Payload = null;
let currentFileName = null;
let lastRunId = null;
let awaitingNewRun = false;
let isManualOverride = false;

document.getElementById('sourceInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        base64Payload = ev.target.result.split(',')[1];
        currentFileName = file.name;
        loadImg(e, baseImg, () => hasBase = true);
    };
    reader.readAsDataURL(file);
};

document.getElementById('processBtn').onclick = () => {
    if (!base64Payload) return alert("Select an image first.");
    hide('init-ui');
    show('terminal-wrapper');
    currentStepIdx = 0;
    executeStep(0);
};

async function executeStep(idx, coords = "", prompt = "") {
    const step = WORKFLOW[idx];
    if (!step) return;

    isManualOverride = !!(coords || prompt);
    log(`INITIATING: ${step.title}...`, 'warn');
    terminalStatus.textContent = "SYNCHRONIZING";
    
    hide('approval-ui');
    hide('manual-crop-ui');
    hide('manual-prompt-ui');

    if (step.id === 'align') {
        log("Manual Alignment Mode triggered.", "warn");
        document.querySelector('[data-target="realigner-tab"]').click();
        return;
    }

    try {
        // Sync check to avoid ghost runs
        const pre = await fetch(proxyUrl).then(r => r.json());
        lastRunId = pre.run_id;
        awaitingNewRun = true;

        await fetch(proxyUrl, {
            method: 'POST',
            body: JSON.stringify({
                path: `inbox/${currentFileName}`,
                content: base64Payload,
                job: step.id,
                layers: layersInput.value,
                coords: coords,
                prompt: prompt
            })
        });

        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(() => poll(step), 4000);
    } catch (e) {
        log(`System Error: ${e.message}`, "error");
    }
}

async function poll(step) {
    try {
        const data = await fetch(proxyUrl).then(r => r.json());
        
        if (awaitingNewRun) {
            if (data.run_id !== lastRunId) {
                awaitingNewRun = false;
                log(`Runner active (ID: ${data.run_id}).`, "info");
            } else {
                terminalStatus.textContent = "QUEUED";
                return;
            }
        }

        terminalStatus.textContent = data.status.toUpperCase();

        if (data.status === 'completed') {
            clearInterval(pollInterval);
            if (data.conclusion === 'failure') return log("Runner crashed.", "error");

            log(`${step.title} complete.`, "info");

            if (step.id === 'segment') {
                terminalStatus.textContent = "DONE";
                return log("Final package generated.", "info");
            }

            if (isManualOverride) {
                currentStepIdx++;
                return executeStep(currentStepIdx);
            }

            const url = data.artifacts[step.key];
            document.getElementById('approval-title').textContent = step.title;
            document.getElementById('approval-preview').src = url;
            show('approval-ui');
            
            if (step.id === 'depth') {
                depthImg.onload = () => { hasDepth = true; drawCanvas(); };
                depthImg.src = url;
            }
        }
    } catch (e) { console.error(e); }
}

document.getElementById('btn-approve').onclick = () => {
    currentStepIdx++;
    executeStep(currentStepIdx);
};

document.getElementById('btn-reject').onclick = () => {
    hide('approval-ui');
    if (currentStepIdx === 0) initCropUI();
    else if (currentStepIdx === 1) show('manual-prompt-ui');
    else { show('init-ui'); hide('terminal-wrapper'); }
};

document.getElementById('btn-submit-prompt').onclick = () => {
    const p = document.getElementById('customPromptInput').value.trim();
    if (p) executeStep(currentStepIdx, "", p);
};

// --- Manual Crop Logic ---
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas ? cropCanvas.getContext('2d') : null;
let cropPoints = [];
let dragIdx = -1;

function initCropUI() {
    show('manual-crop-ui');
    cropCanvas.width = baseImg.width;
    cropCanvas.height = baseImg.height;
    const inset = 100;
    cropPoints = [
        {x: inset, y: inset}, {x: baseImg.width-inset, y: inset},
        {x: baseImg.width-inset, y: baseImg.height-inset}, {x: inset, y: baseImg.height-inset}
    ];
    drawCrop();
}

function drawCrop() {
    cropCtx.drawImage(baseImg, 0, 0);
    cropCtx.strokeStyle = '#00ff00';
    cropCtx.lineWidth = 5;
    cropCtx.beginPath();
    cropCtx.moveTo(cropPoints[0].x, cropPoints[0].y);
    cropPoints.forEach(p => cropCtx.lineTo(p.x, p.y));
    cropCtx.closePath();
    cropCtx.stroke();
    cropCtx.fillStyle = '#ff4444';
    cropPoints.forEach(p => {
        cropCtx.beginPath(); cropCtx.arc(p.x, p.y, 15, 0, 7); cropCtx.fill();
    });
}

if (cropCanvas) {
    cropCanvas.onmousedown = (e) => {
        const rect = cropCanvas.getBoundingClientRect();
        const s = cropCanvas.width / rect.width;
        const x = (e.clientX - rect.left) * s, y = (e.clientY - rect.top) * s;
        dragIdx = cropPoints.findIndex(p => Math.hypot(p.x-x, p.y-y) < 30);
    };
    cropCanvas.onmousemove = (e) => {
        if (dragIdx < 0) return;
        const rect = cropCanvas.getBoundingClientRect();
        const s = cropCanvas.width / rect.width;
        cropPoints[dragIdx].x = (e.clientX - rect.left) * s;
        cropPoints[dragIdx].y = (e.clientY - rect.top) * s;
        drawCrop();
    };
    window.onmouseup = () => dragIdx = -1;
}

document.getElementById('btn-submit-crop').onclick = () => {
    const c = cropPoints.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(',');
    executeStep(currentStepIdx, c);
};

// --- Realigner Logic ---
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let baseImg = new Image(), depthImg = new Image();
let hasBase = false, hasDepth = false;

const controls = ['x','y','scale','rot','op'].reduce((acc, id) => {
    const el = document.getElementById(id);
    el.oninput = () => {
        document.getElementById(id+'Val').textContent = el.value;
        drawCanvas();
    };
    acc[id] = el;
    return acc;
}, {});

function drawCanvas() {
    if (!hasBase || !ctx) return;
    canvas.width = baseImg.width; canvas.height = baseImg.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImg, 0, 0);
    if (hasDepth) {
        ctx.save();
        ctx.globalAlpha = controls.op.value / 100;
        ctx.translate(canvas.width/2 + +controls.x.value, canvas.height/2 + +controls.y.value);
        ctx.rotate(+controls.rot.value * Math.PI / 180);
        const s = +controls.scale.value / 100;
        ctx.scale(s, s);
        ctx.drawImage(depthImg, -depthImg.width/2, -depthImg.height/2);
        ctx.restore();
    }
}

document.getElementById('exportBtn').onclick = () => {
    const exp = document.createElement('canvas');
    exp.width = baseImg.width; exp.height = baseImg.height;
    const eCtx = exp.getContext('2d');
    eCtx.translate(exp.width/2 + +controls.x.value, exp.height/2 + +controls.y.value);
    eCtx.rotate(+controls.rot.value * Math.PI / 180);
    const s = +controls.scale.value / 100;
    eCtx.scale(s, s);
    eCtx.drawImage(depthImg, -depthImg.width/2, -depthImg.height/2);
    
    const a = document.createElement('a');
    a.download = 'realigned_depth_map.png';
    a.href = exp.toDataURL();
    a.click();
    
    document.querySelector('[data-target="pipeline-tab"]').click();
    currentStepIdx++;
    executeStep(currentStepIdx);
};

function loadImg(e, img, cb) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        img.onload = () => { cb(); drawCanvas(); };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(e.target.files[0]);
}

function loadImgUrl(url, img, cb) {
    img.onload = () => { cb(); drawCanvas(); };
    img.src = url;
}
