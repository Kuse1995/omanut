// Returns public Meta App config (App ID + Login Config ID) for the frontend SDK.
// No secrets are exposed — App ID and Config ID are public values, designed to be embedded in client-side code.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const app_id = Deno.env.get("META_APP_ID") ?? null;
  const config_id = Deno.env.get("META_CONFIG_ID") ?? null;

  return new Response(
    JSON.stringify({
      app_id,
      config_id,
      configured: Boolean(app_id),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
