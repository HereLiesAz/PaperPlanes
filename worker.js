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

      // --- IMAGE PROXY ENDPOINT ---
      const fileParam = url.searchParams.get("file");
      if (request.method === "GET" && fileParam) {
        const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${fileParam}`, {
          headers: {
            "User-Agent": "Cloudflare-Worker",
            "Authorization": `Bearer ${githubToken}`,
            "Accept": "application/vnd.github.v3.raw" 
          }
        });

        if (!fileRes.ok) {
          return new Response("Artifact not yet pushed to GitHub main branch.", { 
            status: 404, 
            headers: corsHeaders 
          });
        }

        // Force the content type so the browser doesn't try to download it as a 'file'
        const contentType = fileParam.endsWith('.png') ? 'image/png' : 'image/jpeg';
        
        return new Response(fileRes.body, { 
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Cache-Control": "no-cache, no-store, must-revalidate"
          } 
        });
      }

      // --- POLLING ENDPOINT ---
      if (request.method === "GET") {
        const headers = {
          "User-Agent": "Cloudflare-Worker",
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json"
        };

        const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, { headers });
        if (!runsRes.ok) {
          return new Response(JSON.stringify({ error: "GITHUB API REJECTED GET", details: await runsRes.text() }), { 
            status: 418, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const runsData = await runsRes.json();
        const latestRun = runsData.workflow_runs[0];

        if (!latestRun) {
          return new Response(JSON.stringify({ status: "idle", conclusion: null, jobs: [] }), { 
            status: 200, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const jobsRes = await fetch(latestRun.jobs_url, { headers });
        const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };

        const baseUrl = url.origin + url.pathname;
        const cacheBuster = `&t=${new Date(latestRun.updated_at).getTime() || Date.now()}`;

        const payload = {
          run_id: latestRun.id,
          status: latestRun.status,
          conclusion: latestRun.conclusion,
          jobs: jobsData.jobs || [],
          artifacts: {
            output: `${baseUrl}?file=workspace/cropped_image.png${cacheBuster}`, 
            photo: `${baseUrl}?file=workspace/generated_image.png${cacheBuster}`,
            depth: `${baseUrl}?file=workspace/raw_depth_map.png${cacheBuster}`
          }
        };

        return new Response(JSON.stringify(payload), { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // --- TRIGGER ENDPOINT ---
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
        const getFileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
        if (getFileRes.ok) {
          const fileData = await getFileRes.json();
          fileSha = fileData.sha;
        }

        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
          method: "PUT",
          headers: headers,
          body: JSON.stringify({
            message: message || "Automated payload injection",
            content: content,
            branch: "main",
            sha: fileSha || undefined
          })
        });

        if (!putRes.ok) {
          return new Response(JSON.stringify({ error: "UPLOAD FAILED", details: await putRes.text() }), { 
            status: 418, 
            headers: corsHeaders 
          });
        }

        const dispatchRes = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            event_type: "pipeline_trigger",
            client_payload: { job, layers, file: path, coords, prompt }
          })
        });

        return new Response(JSON.stringify({ success: true }), { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), { 
        status: 405, 
        headers: corsHeaders 
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: "CRASH", message: error.message }), { 
        status: 202, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }
};
