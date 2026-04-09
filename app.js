document.getElementById('processBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('sourceInput');
    const layersCount = document.getElementById('layersInput').value;
    const statusEl = document.getElementById('status');

    if (!fileInput.files.length) {
        statusEl.style.color = "#ff4444";
        statusEl.textContent = "Error: Please select a source image.";
        return;
    }

    const file = fileInput.files[0];
    const extension = file.name.split('.').pop();
    
    // Format the filename for the Python regex
    const newFilename = `original_layers-${layersCount}.${extension}`;

    statusEl.style.color = "#e0e0e0";
    statusEl.textContent = "Reading image...";

    const reader = new FileReader();
    reader.onload = async function(event) {
        // Strip the base64 URI prefix
        const base64Content = event.target.result.split(',')[1];

        statusEl.textContent = "Transmitting to Cloudflare proxy...";

        try {
            // Hardwired to your Cloudflare Worker domain
            const proxyUrl = "https://paperplanes.hereliesaz.workers.dev"; 

            const response = await fetch(proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: `inbox/${newFilename}`,
                    content: base64Content,
                    message: `Pipeline upload: ${newFilename}`
                })
            });

            if (response.ok) {
                statusEl.style.color = "#00C851";
                statusEl.textContent = "Success: Image uploaded to inbox. GitHub Action initiated.";
            } else {
                const errData = await response.text();
                statusEl.style.color = "#ff4444";
                statusEl.textContent = `Upload failed: ${response.status} - ${errData}`;
            }
        } catch (error) {
            statusEl.style.color = "#ff4444";
            statusEl.textContent = `Network error: ${error.message}`;
        }
    };

    reader.readAsDataURL(file);
});
