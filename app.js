/**
 * @fileoverview Application logic for Paper Planes.
 * Manages the sequential paper theater pipeline, state transitions, and UI facets.
 */

const show = (id) => document.getElementById(id).style.display = 'block';
const hide = (id) => document.getElementById(id).style.display = 'none';

/**
 * Handle the dramatic introduction (Splash Screen) removal.
 */
window.addEventListener('load', () => {
    const splash = document.getElementById('splash');
    setTimeout(() => {
        splash.style.opacity = '0';
        setTimeout(() => {
            splash.style.visibility = 'hidden';
        }, 1500);
    }, 2000);
});

/**
 * Tab Navigation Logic
 */
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    };
});

/**
 * Terminal Telemetry Logging
 * @param {string} msg - The status message to log.
 */
const terminal = document.getElementById('terminal');
const log = (msg) => {
    const line = document.createElement('div');
    line.innerHTML = `<span style="color:#444">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
};

/**
 * The Sequential Deconstruction Workflow.
 * Maps pipeline steps to their corresponding artifact keys.
 */
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

/**
 * Ingest source imagery into memory.
 */
document.getElementById('sourceInput').onchange = (e) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
        base64 = ev.target.result.split(',')[1];
        fileName = e.target.files[0].name;
        log(`Source loaded: ${fileName}`);
    };
    reader.readAsDataURL(e.target.files[0]);
};

/**
 * Begin the stratified pipeline.
 */
document.getElementById('processBtn').onclick = () => {
    if (!base64) return alert("Ingest source first.");
    hide('init-ui');
    execute(0);
};

/**
 * Execute a pipeline step and poll for the resulting hallucination.
 * @param {number} idx - Workflow step index.
 * @param {string} coords - Manual crop coordinates if applicable.
 * @param {string} prompt - Manual semantic override if applicable.
 */
async function execute(idx, coords = "", prompt = "") {
    const step = WORKFLOW[idx];
    log(`Attempting strata deconstruction: ${step.id.toUpperCase()}...`);
    hide('approval-ui'); hide('manual-crop-ui'); hide('manual-prompt-ui');

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
        try {
            const res = await fetch(proxy).then(r => r.json());
            document.getElementById('terminalStatus').textContent = res.status.toUpperCase();
            
            if (res.status === 'completed') {
                clearInterval(poller);
                if (step.id === 'segment') {
                    log("Final strata alignment complete. The theater is ready.");
                    return;
                }
                if (coords || prompt) return execute(idx + 1);
                
                document.getElementById('approval-preview').src = `${res.artifacts[step.key]}?t=${Date.now()}`;
                show('approval-ui');
            } else if (res.status === 'failed') {
                clearInterval(poller);
                log(`FATAL: Strata fault in ${step.id}.`, 'error');
            }
        } catch (e) {
            log("Polling interference detected.");
        }
    }, 4000);
}

/**
 * Step approval and manual override logic.
 */
document.getElementById('btn-approve').onclick = () => {
    currentIdx++;
    execute(currentIdx);
};

document.getElementById('btn-reject').onclick = () => {
    log("Human override initiated. Re-calculating parameters.");
    if (currentIdx === 0) show('manual-crop-ui');
    else if (currentIdx === 1) show('manual-prompt-ui');
};

document.getElementById('btn-submit-prompt').onclick = () => {
    execute(currentIdx, "", document.getElementById('customPromptInput').value);
};

// Update UI display for layers
document.getElementById('layersInput').oninput = (e) => {
    document.getElementById('layerDisplay').textContent = e.target.value;
};
