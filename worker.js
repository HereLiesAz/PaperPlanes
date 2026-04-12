const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const repo = env.GH_REPO;
      const githubToken = env.GH_TOKEN; 

      if (!githubToken || !repo) {
        return new Response(JSON.stringify({ error: "SECRETS MISSING" }), { 
          status: 418, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // --- IMAGE PROXY ---
      const fileParam = url.searchParams.get("file");
      if (request.method === "GET" && fileParam) {
        const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${fileParam}`, {
          headers: {
            "User-Agent": "Cloudflare-Worker",
            "Authorization": `Bearer ${githubToken}`,
            "Accept": "application/vnd.github.v3.raw" 
          }
        });

        if (!fileRes.ok) return new Response("File not found", { status: 404, headers: corsHeaders });

        const contentType = fileParam.endsWith('.png') ? 'image/png' : 'image/jpeg';
        return new Response(fileRes.body, { 
          headers: { ...corsHeaders, "Content-Type": contentType, "Cache-Control": "no-cache" } 
        });
      }

      // --- POLLING WITH READINESS CHECK ---
      if (request.method === "GET") {
        const headers = {
          "User-Agent": "Cloudflare-Worker",
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json"
        };

        const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, { headers });
        const runsData = await runsRes.json();
        const latestRun = runsData.workflow_runs[0];

        if (!latestRun) {
          return new Response(JSON.stringify({ status: "idle" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const isReady = latestRun.status === "completed" && latestRun.conclusion === "success";
        const baseUrl = url.origin + url.pathname;
        const cacheBuster = `&t=${new Date(latestRun.updated_at).getTime()}`;

        const payload = {
          run_id: latestRun.id,
          status: latestRun.status,
          conclusion: latestRun.conclusion,
          is_ready: isReady,
          artifacts: isReady ? {
            output: `${baseUrl}?file=workspace/cropped_image.png${cacheBuster}`, 
            photo: `${baseUrl}?file=workspace/generated_image.png${cacheBuster}`,
            depth: `${baseUrl}?file=workspace/raw_depth_map.png${cacheBuster}`
          } : null
        };

        return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- TRIGGER ---
      if (request.method === "POST") {
        const body = await request.json();
        const { path, content, message, job, layers, coords, prompt } = body;
        const headers = {
          "User-Agent": "Cloudflare-Worker",
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        };

        let fileSha = null;
        const getFile = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
        if (getFile.ok) fileSha = (await getFile.json()).sha;

        await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ message: message || "Update", content, sha: fileSha || undefined })
        });

        await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
          method: "POST",
          headers,
          body: JSON.stringify({ event_type: "pipeline_trigger", client_payload: { job, layers, coords, prompt } })
        });

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};
