import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.0';

// Force WebAssembly execution for static GitHub Pages hosting
env.allowLocalModels = false;

const upload = document.getElementById('upload');
const stage = document.getElementById('stage');
const loading = document.getElementById('loading');
const numLayersInput = document.getElementById('numLayers');

let depthEstimator = null;

async function initModel() {
    if (!depthEstimator) {
        loading.style.display = 'block';
        loading.innerText = 'Loading Depth-Anything model (WASM)...';
        depthEstimator = await pipeline('depth-estimation', 'Xenova/depth-anything-small-hf');
        loading.style.display = 'none';
    }
}

upload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    await initModel();
    loading.style.display = 'block';
    loading.innerText = 'Hallucinating the Z-axis...';
    stage.innerHTML = '';

    const reader = new FileReader();
    reader.onload = async (event) => {
        const img = new Image();
        img.onload = async () => {
            await processImage(img);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

async function processImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    
    // Pass image to Transformers.js
    const rawImage = await RawImage.fromURL(img.src);
    const { depth } = await depthEstimator(rawImage);
    
    const depthData = depth.data;
    let minDepth = 255, maxDepth = 0;
    for (let i = 0; i < depthData.length; i++) {
        if (depthData[i] < minDepth) minDepth = depthData[i];
        if (depthData[i] > maxDepth) maxDepth = depthData[i];
    }

    const numLayers = parseInt(numLayersInput.value);
    const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const depthWidth = depth.width;
    const depthHeight = depth.height;

    // Slice the spectrum
    for (let layer = 0; layer < numLayers; layer++) {
        const lowerBound = minDepth + (layer / numLayers) * (maxDepth - minDepth);
        const upperBound = minDepth + ((layer + 1) / numLayers) * (maxDepth - minDepth);
        
        const layerCanvas = document.createElement('canvas');
        layerCanvas.width = canvas.width;
        layerCanvas.height = canvas.height;
        const layerCtx = layerCanvas.getContext('2d');
        const layerImgData = layerCtx.createImageData(canvas.width, canvas.height);
        
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                // Map high-res image coordinates to low-res depth map coordinates
                const dx = Math.floor((x / canvas.width) * depthWidth);
                const dy = Math.floor((y / canvas.height) * depthHeight);
                const dIndex = dy * depthWidth + dx;
                
                // depth-anything: 255 is closest, 0 is furthest
                const dValue = depthData[dIndex];
                
                if (dValue >= lowerBound && (dValue < upperBound || layer === numLayers - 1)) {
                    const i = (y * canvas.width + x) * 4;
                    layerImgData.data[i] = originalData[i];
                    layerImgData.data[i+1] = originalData[i+1];
                    layerImgData.data[i+2] = originalData[i+2];
                    layerImgData.data[i+3] = 255;
                }
            }
        }
        layerCtx.putImageData(layerImgData, 0, 0);
        
        const layerImg = document.createElement('img');
        layerImg.src = layerCanvas.toDataURL();
        layerImg.className = 'layer';
        
        // Push background layers away, scale them up to preserve original framing when centered
        const zTranslate = (numLayers - 1 - layer) * -150; 
        const scaleFactor = 1 + Math.abs(zTranslate) / 1200;
        layerImg.style.transform = `translateZ(${zTranslate}px) scale(${scaleFactor})`;
        
        stage.appendChild(layerImg);
    }
    loading.style.display = 'none';
}

// Puppet mastering
let rotX = 0, rotY = 0;

function updateStageTransform(xRatio, yRatio) {
    rotY = xRatio * 35; 
    rotX = -yRatio * 35;
    stage.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
}

document.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    updateStageTransform(x, y);
});

document.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    const x = (touch.clientX / window.innerWidth - 0.5) * 2;
    const y = (touch.clientY / window.innerHeight - 0.5) * 2;
    updateStageTransform(x, y);
}, { passive: true });
