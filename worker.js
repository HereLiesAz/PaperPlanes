const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
      const url = new URL(request.url);
      const repo = env.GH_REPO;
      const githubToken = env.GH_TOKEN; 

      if (!githubToken || !repo) {
        return new Response(JSON.stringify({ error: "SECRETS_MISSING" }), { status: 418, headers: corsHeaders });
      }

      // --- IMAGE PROXY (Direct from Repo Meta) ---
      const fileParam = url.searchParams.get("file");
      if (request.method === "GET" && fileParam) {
        const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${fileParam}`, {
          headers: {
            "User-Agent": "Cloudflare-Worker",
            "Authorization": `Bearer ${githubToken}`,
            "Accept": "application/vnd.github.v3+json"
          }
        });
        if (!fileRes.ok) return new Response("404", { status: 404, headers: corsHeaders });
        const data = await fileRes.json();
        const binaryString = atob(data.content.replace(/\n/g, ""));
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        
        return new Response(bytes, { 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "image/png",
            "Cache-Control": "no-cache, no-store, must-revalidate"
          } 
        });
      }

      // --- POLLING ---
      if (request.method === "GET") {
        const headers = {
          "User-Agent": "Cloudflare-Worker",
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json"
        };
        const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, { headers });
        const runsData = await runsRes.json();
        const latestRun = runsData.workflow_runs[0];
        
        if (!latestRun) return new Response(JSON.stringify({ status: "idle" }), { headers: corsHeaders });

        const baseUrl = url.origin + url.pathname;
        // Injecting run_id so the frontend can differentiate between executions
        return new Response(JSON.stringify({
          run_id: latestRun.id,
          status: latestRun.status,
          conclusion: latestRun.conclusion,
          artifacts: {
            output: `${baseUrl}?file=workspace/cropped_image.png&t=${Date.now()}`, 
            photo: `${baseUrl}?file=workspace/generated_image.png&t=${Date.now()}`,
            depth: `${baseUrl}?file=workspace/raw_depth_map.png&t=${Date.now()}`
          }
        }), { headers: corsHeaders });
      }

      // --- TRIGGER ---
      if (request.method === "POST") {
        const body = await request.json();
        const headers = {
          "User-Agent": "Cloudflare-Worker",
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        };

        let fileSha = null;
        const getFile = await fetch(`https://api.github.com/repos/${repo}/contents/${body.path}`, { headers });
        if (getFile.ok) {
          const fileData = await getFile.json();
          fileSha = fileData.sha;
        }

        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${body.path}`, {
          method: "PUT",
          headers: headers,
          body: JSON.stringify({
            message: `Upload ${body.job}`,
            content: body.content,
            branch: "main",
            sha: fileSha || undefined
          })
        });

        if (!putRes.ok) return new Response(await putRes.text(), { status: 418, headers: corsHeaders });

        await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            event_type: "pipeline_trigger",
            client_payload: { 
              job: body.job, 
              layers: body.layers, 
              coords: body.coords, 
              prompt: body.prompt 
            }
          })
        });

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
    } catch (e) {
      return new Response(e.message, { status: 500, headers: corsHeaders });
    }
  }
};
