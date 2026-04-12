/**
 * @fileoverview Logic for PaperPlanes. 
 * Orchestrates the sequential pipeline from 2D ingestion to 3D stratified output.
 */

const show = (id) => document.getElementById(id).style.display = 'block';
const hide = (id) => document.getElementById(id).style.display = 'none';

/**
 * Handle Splash Screen Fade
 */
window.addEventListener('DOMContentLoaded', () => {
    const splash = document.getElementById('splash');
    setTimeout(() => {
        splash.style.opacity = '0';
        setTimeout(() => {
            splash.style.visibility = 'hidden';
        }, 1500);
    }, 2500);
});

/**
 * Tab Navigation
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
 * Terminal Logging
 */
const terminal = document.getElementById('terminal');
const log = (msg) => {
    const line = document.createElement('div');
    line.innerHTML = `<span style="color:#333">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
};

/**
 * Pipeline Workflow Configuration
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
 * File Ingestion Handler
 */
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

/**
 * Initial Trigger
 */
document.getElementById('processBtn').onclick = () => {
    if (!base64) return alert("Source missing from theater.");
    hide('init-ui');
    execute(0);
};

/**
 * Execute Workflow Step
 * @param {number} idx - Step index
 * @param {string} coords - Manual warp coords
 * @param {string} prompt - Manual semantic prompt
 */
async function execute(idx, coords = "", prompt = "") {
    const step = WORKFLOW[idx];
    log(`Deconstructing layer: ${step.id.toUpperCase()}...`);
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
            document.getElementById('terminalStatus').textContent = res.status.toUpperCase();
            
            if (res.status === 'completed') {
                clearInterval(poller);
                if (step.id === 'segment') {
                    log("Final stratification archived. The theater is complete.");
                    return;
                }
                if (coords || prompt) return execute(idx + 1);
                
                // Cache busting mandatory for GitHub artifact synchronization
                document.getElementById('approval-preview').src = `${res.artifacts[step.key]}?t=${Date.now()}`;
                show('approval-ui');
            } else if (res.status === 'failed') {
                clearInterval(poller);
                log(`CRITICAL FAULT: ${step.id} collapsed.`, 'error');
            }
        }, 4000);
    } catch (err) {
        log(`Network Dissonance: ${err.message}`);
    }
}

/**
 * Decision Gates
 */
document.getElementById('btn-approve').onclick = () => {
    currentIdx++;
    execute(currentIdx);
};

document.getElementById('btn-reject').onclick = () => {
    log("Human Intervention: Rejecting مشین outcome.");
    if (currentIdx === 0) show('manual-crop-ui');
    else if (currentIdx === 1) show('manual-prompt-ui');
};

document.getElementById('btn-submit-prompt').onclick = () => {
    execute(currentIdx, "", document.getElementById('customPromptInput').value);
};

document.getElementById('layersInput').oninput = (e) => {
    document.getElementById('layerDisplay').textContent = e.target.value;
};
