/**
 * Application logic for Paper Planes.
 * Handles UI transitions, theater pipeline execution, and cache-busting.
 */

const show = (id) => document.getElementById(id).style.display = 'block';
const hide = (id) => document.getElementById(id).style.display = 'none';

// Splash screen removal logic
window.addEventListener('load', () => {
    const splash = document.getElementById('splash');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.style.visibility = 'hidden';
            }, 1000);
        }, 1500);
    }
});

// Tab navigation logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.target);
        if (target) target.classList.add('active');
    };
});

const terminal = document.getElementById('terminal');

/**
 * Logs a message to the on-screen terminal.
 * @param {string} msg - The message to display.
 */
const log = (msg) => {
    const line = document.createElement('div');
    line.innerHTML = `<span style="color:#666">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
};

const WORKFLOW = [
    { id: 'crop', key: 'output' },
    { id: 'generate', key: 'photo' },
    { id: 'depth', key: 'depth' },
    { id: 'align', key: null },
    { id: 'segment', key: null }
];

let currentIdx = 0;
let base64 = null;
let fileName = null;
const proxy = "https://paperplanes.hereliesaz.workers.dev/api";

document.getElementById('sourceInput').onchange = (e) => {
    if (!e.target.files[0]) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        base64 = ev.target.result.split(',')[1];
        fileName = e.target.files[0].name;
        log(`Source Manifested: ${fileName}`);
    };
    reader.readAsDataURL(e.target.files[0]);
};

document.getElementById('processBtn').onclick = () => {
    if (!base64) return alert("Select image.");
    hide('init-ui');
    execute(0);
};

/**
 * Triggers a pipeline step and polls for the resulting artifact.
 * @param {number} idx - Index of the WORKFLOW step.
 * @param {string} coords - Manual crop coordinates (if any).
 * @param {string} prompt - Manual prompt override (if any).
 */
async function execute(idx, coords = "", prompt = "") {
    const step = WORKFLOW[idx];
    log(`Deconstructing: ${step.id.toUpperCase()}`);
    hide('approval-ui'); hide('manual-crop-ui'); hide('manual-prompt-ui');

    try {
        await fetch(proxy, {
            method: 'POST',
            body: JSON.stringify({ 
                path: `inbox/${fileName}`, 
                content: base64, 
                job: step.id, 
                coords, 
                prompt,
                layers: document.getElementById('layersInput').value 
            })
        });

        const poller = setInterval(async () => {
            const res = await fetch(proxy).then(r => r.json());
            const statusDisplay = document.getElementById('terminalStatus');
            if (statusDisplay) statusDisplay.textContent = res.status.toUpperCase();
            
            if (res.status === 'completed') {
                clearInterval(poller);
                if (step.id === 'segment') return log("Done.");
                if (coords || prompt) return execute(idx + 1);
                
                // Cache buster ensures the current artifact is fetched over cached versions
                const preview = document.getElementById('approval-preview');
                if (preview) {
                    preview.src = `${res.artifacts[step.key]}?t=${Date.now()}`;
                    show('approval-ui');
                }
            } else if (res.status === 'failed') {
                clearInterval(poller);
                log(`Error in ${step.id}`);
            }
        }, 4000);
    } catch (err) {
        log(`Network error: ${err.message}`);
    }
}

document.getElementById('btn-approve').onclick = () => {
    currentIdx++;
    execute(currentIdx);
};

document.getElementById('btn-reject').onclick = () => {
    if (currentIdx === 0) show('manual-crop-ui');
    else if (currentIdx === 1) show('manual-prompt-ui');
};

document.getElementById('btn-submit-prompt').onclick = () => {
    const promptInput = document.getElementById('customPromptInput');
    execute(currentIdx, "", promptInput ? promptInput.value : "");
};

// Update range display
const layersInput = document.getElementById('layersInput');
if (layersInput) {
    layersInput.oninput = (e) => {
        const display = document.getElementById('layerDisplay');
        if (display) display.textContent = e.target.value;
    };
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
}
