const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    // 1. Pacify the Browser's CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // --- POLLING ENDPOINT (GET) ---
      if (request.method === "GET") {
        const repo = "hereliesaz/paperplanes";
        const githubToken = env.GITHUB_TOKEN; 
        
        if (!githubToken) {
          return new Response(JSON.stringify({ error: "GITHUB_TOKEN secret not configured in worker environment." }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const headers = {
          "User-Agent": "Cloudflare-Worker",
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json"
        };

        // Fetch the latest workflow run
        const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, { headers });
        if (!runsRes.ok) {
          return new Response(JSON.stringify({ error: "Failed to fetch GitHub Actions telemetry." }), { 
            status: runsRes.status, 
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

        // Fetch individual jobs for the latest run
        const jobsRes = await fetch(latestRun.jobs_url, { headers });
        const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };

        // Return standardized telemetry payload to the frontend
        const payload = {
          status: latestRun.status,
          conclusion: latestRun.conclusion,
          jobs: jobsData.jobs || [],
          artifacts: {
            output: `/workspace/cropped_image.png`, 
            photo: `/workspace/generated_image.png`,
            depth: `/workspace/raw_depth_map.png`
          }
        };

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // --- TRIGGER ENDPOINT (POST) ---
      if (request.method === "POST") {
        const body = await request.json();
        const { path, content, message, job, layers } = body;
        const repo = "hereliesaz/paperplanes";
        const githubToken = env.GITHUB_TOKEN;

        if (!githubToken) {
          return new Response(JSON.stringify({ error: "GITHUB_TOKEN secret not configured." }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        if (!path || !content) {
          return new Response(JSON.stringify({ error: "Missing path or content payload." }), { 
            status: 400, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const headers = {
          "User-Agent": "Cloudflare-Worker",
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        };

        // 1. Check if the file already exists in the repo to obtain its SHA (required for overwrite)
        let fileSha = null;
        const getFileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
        if (getFileRes.ok) {
          const fileData = await getFileRes.json();
          fileSha = fileData.sha;
        }

        // 2. Inject the file content to GitHub 
        const putBody = {
          message: message || "Automated payload injection via UI proxy",
          content: content,
          branch: "main"
        };
        if (fileSha) putBody.sha = fileSha;

        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
          method: "PUT",
          headers: headers,
          body: JSON.stringify(putBody)
        });

        if (!putRes.ok) {
          const errText = await putRes.text();
          return new Response(JSON.stringify({ error: "Failed to inject file to repository.", details: errText }), { 
            status: putRes.status, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        // 3. Dispatch the specific workflow job
        const dispatchRes = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            event_type: "pipeline_trigger",
            client_payload: {
              job: job || "segment",
              layers: layers || "6",
              file: path
            }
          })
        });

        return new Response(JSON.stringify({ success: true, message: "Payload delivered. GitHub Runner awoken." }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // If neither GET nor POST
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), { 
        status: 405, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }
};
