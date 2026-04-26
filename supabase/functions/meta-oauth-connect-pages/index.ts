// Finalises the Meta OAuth flow: takes the user-selected Page IDs from a meta_oauth_sessions
// row, upserts them into meta_credentials, subscribes the Page (and IG, if linked) to webhooks,
// and deletes the temp session.
//
// Input: { session_id: string, page_ids: string[] }
// Output: { connected: [{ page_id, page_name, ig_linked, webhook_subscribed, error? }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FB_GRAPH = "https://graph.facebook.com/v19.0";

interface CachedPage {
  id: string;
  name: string;
  picture_url: string | null;
  access_token: string;
  ig_user_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError(401, "Missing Authorization header");

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userRes } = await supabaseUser.auth.getUser();
    const user = userRes?.user;
    if (!user) return jsonError(401, "Invalid session");

    const { session_id, page_ids } = await req.json().catch(() => ({}));
    if (!session_id || !Array.isArray(page_ids) || page_ids.length === 0) {
      return jsonError(400, "session_id and a non-empty page_ids[] are required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load session
    const { data: session, error: sessErr } = await supabase
      .from("meta_oauth_sessions")
      .select("id, user_id, company_id, pages, expires_at")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr || !session) return jsonError(404, "OAuth session not found");
    if (session.user_id !== user.id) {
      // Global admins may finalize sessions they didn't open (rare, but consistent with exchange step)
      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!adminRole) return jsonError(403, "Session belongs to another user");
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return jsonError(410, "OAuth session expired. Please reconnect Facebook.");
    }

    const pages = (session.pages as CachedPage[]) ?? [];
    const selected = pages.filter((p) => page_ids.includes(p.id));
    if (selected.length === 0) {
      return jsonError(400, "None of the requested page_ids were found in this session");
    }

    const connected: Array<{
      page_id: string;
      page_name: string;
      ig_linked: boolean;
      webhook_subscribed: boolean;
      error?: string;
    }> = [];

    for (const page of selected) {
      try {
        // Upsert into meta_credentials (one row per page per company)
        const { data: existing } = await supabase
          .from("meta_credentials")
          .select("id")
          .eq("company_id", session.company_id)
          .eq("page_id", page.id)
          .maybeSingle();

        const payload = {
          company_id: session.company_id,
          user_id: user.id,
          page_id: page.id,
          page_name: page.name,
          page_picture_url: page.picture_url,
          access_token: page.access_token,
          platform: "facebook",
          ig_user_id: page.ig_user_id,
          connected_via: "oauth",
          last_verified_at: new Date().toISOString(),
          health_status: "healthy",
          updated_at: new Date().toISOString(),
        };

        let credentialId: string;
        if (existing) {
          const { error } = await supabase
            .from("meta_credentials")
            .update(payload)
            .eq("id", existing.id);
          if (error) throw error;
          credentialId = existing.id;
        } else {
          const { data: inserted, error } = await supabase
            .from("meta_credentials")
            .insert(payload)
            .select("id")
            .single();
          if (error) throw error;
          credentialId = inserted.id;
        }

        // Subscribe Page to webhook events
        let webhookOk = false;
        try {
          const subRes = await fetch(`${FB_GRAPH}/${page.id}/subscribed_apps`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscribed_fields: "feed,messages",
              access_token: page.access_token,
            }),
          });
          const subJson = await subRes.json();
          webhookOk = subRes.ok && !subJson.error;
          if (!webhookOk) console.error("Page subscribe failed:", page.id, subJson);
        } catch (e) {
          console.error("Page subscribe exception:", e);
        }

        // Subscribe IG if linked
        if (page.ig_user_id) {
          try {
            const igRes = await fetch(`${FB_GRAPH}/${page.ig_user_id}/subscribed_apps`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subscribed_fields: "messages",
                access_token: page.access_token,
              }),
            });
            const igJson = await igRes.json();
            if (!igRes.ok || igJson.error) {
              console.error("IG subscribe failed:", page.ig_user_id, igJson);
            }
          } catch (e) {
            console.error("IG subscribe exception:", e);
          }
        }

        connected.push({
          page_id: page.id,
          page_name: page.name,
          ig_linked: Boolean(page.ig_user_id),
          webhook_subscribed: webhookOk,
        });
      } catch (err) {
        console.error("Failed to connect page", page.id, err);
        connected.push({
          page_id: page.id,
          page_name: page.name,
          ig_linked: Boolean(page.ig_user_id),
          webhook_subscribed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Cleanup the temp session
    await supabase.from("meta_oauth_sessions").delete().eq("id", session_id);

    return new Response(JSON.stringify({ connected }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("meta-oauth-connect-pages error:", err);
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
