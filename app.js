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
    
    // Format the filename so the Python script knows how many layers to slice
    // Example: original_layers-6.jpg
    const newFilename = `original_layers-${layersCount}.${extension}`;

    statusEl.style.color = "#e0e0e0";
    statusEl.textContent = "Reading image...";

    const reader = new FileReader();
    reader.onload = async function(event) {
        // Strip the data URI scheme (e.g., "data:image/jpeg;base64,")
        const base64Content = event.target.result.split(',')[1];

        statusEl.textContent = "Transmitting to Cloudflare proxy...";

        try {
            // IMPORTANT: Replace this with your actual Cloudflare proxy endpoint
            const proxyUrl = "https://YOUR_CLOUDFLARE_PROXY_URL_HERE"; 

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
                statusEl.textContent = "Success: Image uploaded to inbox. GitHub Action is starting.";
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
