// Temporary diagnostic — verifies MINIMAX_API_KEY against chatcompletion_v2.
// Remove after debugging.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const key = Deno.env.get("MINIMAX_API_KEY") ?? "";
  const masked = key
    ? `${key.slice(0, 8)}…${key.slice(-4)}`
    : "(missing)";

  if (!key) {
    return new Response(
      JSON.stringify({ ok: false, error: "MINIMAX_API_KEY not configured", key_prefix: masked }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }

  let httpStatus = 0;
  let body: any = null;
  let networkError: string | null = null;

  try {
    const res = await fetch("https://api.minimax.io/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "MiniMax-M2",
        max_tokens: 32,
        messages: [
          { role: "system", content: "Reply with a single word." },
          { role: "user", content: "ping" },
        ],
      }),
    });
    httpStatus = res.status;
    body = await res.json().catch(async () => ({ raw: await res.text() }));
  } catch (e) {
    networkError = (e as Error).message;
  }

  const contentPreview =
    body?.choices?.[0]?.message?.content?.toString?.().slice(0, 200) ?? null;

  return new Response(
    JSON.stringify(
      {
        ok: body?.base_resp?.status_code === 0,
        http_status: httpStatus,
        base_resp: body?.base_resp ?? null,
        content_preview: contentPreview,
        key_prefix: masked,
        key_length: key.length,
        network_error: networkError,
      },
      null,
      2,
    ),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
