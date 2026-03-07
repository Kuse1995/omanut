import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { credential_id } = await req.json();
    if (!credential_id) {
      return new Response(
        JSON.stringify({ error: "credential_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load the credential
    const { data: cred, error: credErr } = await supabase
      .from("meta_credentials")
      .select("page_id, access_token, ig_user_id")
      .eq("id", credential_id)
      .single();

    if (credErr || !cred) {
      return new Response(
        JSON.stringify({ error: "Credential not found", details: credErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Subscribe the page to webhook events
    const fields = ["feed", "messages", "instagram_manage_messages"];
    const subscribeUrl = `https://graph.facebook.com/v18.0/${cred.page_id}/subscribed_apps`;

    const fbRes = await fetch(subscribeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscribed_fields: fields.join(","),
        access_token: cred.access_token,
      }),
    });

    const fbData = await fbRes.json();
    console.log("Facebook subscribe response:", JSON.stringify(fbData));

    if (!fbRes.ok || fbData.error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: fbData.error?.message || "Facebook subscription failed",
          fb_response: fbData,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If Instagram is linked, also subscribe for Instagram fields
    let igResult = null;
    if (cred.ig_user_id) {
      // Instagram webhook events come through the page subscription
      // The 'messages' field already covers Instagram DMs when the page has IG linked
      igResult = { note: "Instagram events routed via page subscription" };
    }

    return new Response(
      JSON.stringify({
        success: true,
        page_id: cred.page_id,
        subscribed_fields: fields,
        ig_result: igResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("subscribe-meta-page error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
