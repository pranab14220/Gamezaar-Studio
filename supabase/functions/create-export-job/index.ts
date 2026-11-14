import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("GAMEZAAR_GITHUB_TOKEN");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !githubToken) {
    return json({ error: "Export backend is not configured yet" }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return json({ error: "Invalid project ID" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: job, error: insertError } = await admin
    .from("export_jobs")
    .insert({ user_id: user.id, project_id: projectId, status: "queued" })
    .select("id,status,created_at")
    .single();
  if (insertError || !job) return json({ error: "Could not create export job" }, 500);

  const dispatch = await fetch(
    "https://api.github.com/repos/pranab14220/Gamezaar-Studio/actions/workflows/android-export.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "GAMEZAAR-Studio-Export",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { job_id: job.id, project_id: projectId ?? "" },
      }),
    },
  );

  if (!dispatch.ok) {
    await admin.from("export_jobs").update({
      status: "failed",
      error_message: "GitHub build could not be started",
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return json({ error: "Could not start Android build. Check backend GitHub configuration." }, 502);
  }

  return json({ job });
});
