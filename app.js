const show = (id) => document.getElementById(id).style.display = 'block';
const hide = (id) => document.getElementById(id).style.display = 'none';

window.addEventListener('DOMContentLoaded', () => {
    const splash = document.getElementById('splash');
    setTimeout(() => {
        splash.style.opacity = '0';
        setTimeout(() => { splash.style.visibility = 'hidden'; }, 1000);
    }, 1500);
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    };
});

const terminal = document.getElementById('terminal');
const log = (msg) => {
    const line = document.createElement('div');
    line.innerHTML = `[${new Date().toLocaleTimeString()}] ${msg}`;
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
        log(`Loaded: ${fileName}`);
    };
    reader.readAsDataURL(e.target.files[0]);
};

document.getElementById('processBtn').onclick = () => {
    if (!base64) return alert("Select file.");
    hide('init-ui');
    execute(0);
};

async function execute(idx, coords = "", prompt = "") {
    const step = WORKFLOW[idx];
    log(`Running: ${step.id.toUpperCase()}`);
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
                if (step.id === 'segment') return log("Complete.");
                if (coords || prompt) return execute(idx + 1);
                
                // Cache busting prevents old images from showing
                document.getElementById('approval-preview').src = `${res.artifacts[step.key]}?t=${Date.now()}`;
                show('approval-ui');
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
    execute(currentIdx, "", document.getElementById('customPromptInput').value);
};

document.getElementById('layersInput').oninput = (e) => {
    document.getElementById('layerDisplay').textContent = e.target.value;
};
