const show = (id) => document.getElementById(id).style.display = 'block';
const hide = (id) => document.getElementById(id).style.display = 'none';

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        show(btn.dataset.target);
    };
});

const terminal = document.getElementById('terminal');
const log = (msg, level = 'info') => {
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
    const reader = new FileReader();
    reader.onload = (ev) => {
        base64 = ev.target.result.split(',')[1];
        fileName = e.target.files[0].name;
    };
    reader.readAsDataURL(e.target.files[0]);
};

document.getElementById('processBtn').onclick = () => {
    if (!base64) return alert("Select image.");
    hide('init-ui');
    execute(0);
};

async function execute(idx, coords = "", prompt = "") {
    const step = WORKFLOW[idx];
    log(`Starting: ${step.id}`);
    hide('approval-ui'); hide('manual-crop-ui'); hide('manual-prompt-ui');

    await fetch(proxy, {
        method: 'POST',
        body: JSON.stringify({ path: `inbox/${fileName}`, content: base64, job: step.id, coords, prompt })
    });

    const poller = setInterval(async () => {
        const res = await fetch(proxy).then(r => r.json());
        document.getElementById('terminalStatus').textContent = res.status;
        if (res.status === 'completed') {
            clearInterval(poller);
            if (step.id === 'segment') return log("Done.");
            if (coords || prompt) return execute(idx + 1);
            document.getElementById('approval-preview').src = res.artifacts[step.key];
            show('approval-ui');
        }
    }, 4000);
}

document.getElementById('btn-approve').onclick = () => execute(++currentIdx);
document.getElementById('btn-reject').onclick = () => {
    if (currentIdx === 0) show('manual-crop-ui');
    else if (currentIdx === 1) show('manual-prompt-ui');
};

document.getElementById('btn-submit-prompt').onclick = () => {
    execute(currentIdx, "", document.getElementById('customPromptInput').value);
};
