// Admin-only debug helper: signs a raw body with OPENCLAW_WEBHOOK_SECRET and POSTs it
// verbatim to a target URL. Used to prove byte-for-byte HMAC parity with OpenClaw.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Debug function — no auth gate. Will be deleted after OpenClaw signature parity is confirmed.
  void supabase;

  let body: { target_url?: string; raw_body?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { target_url, raw_body } = body;
  if (!target_url || typeof raw_body !== 'string') {
    return new Response(JSON.stringify({ error: 'missing_fields', need: ['target_url', 'raw_body'] }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const secret = Deno.env.get('OPENCLAW_WEBHOOK_SECRET') ?? '';
  if (!secret) {
    return new Response(JSON.stringify({ error: 'no_secret' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(raw_body));
  const hex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const signature = `sha256=${hex}`;

  let httpStatus = 0;
  let responseText = '';
  try {
    const resp = await fetch(target_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Openclaw-Signature': signature,
      },
      body: raw_body,
      signal: AbortSignal.timeout(15_000),
    });
    httpStatus = resp.status;
    responseText = (await resp.text()).slice(0, 2000);
  } catch (e) {
    responseText = `fetch_error: ${String(e).slice(0, 500)}`;
  }

  return new Response(JSON.stringify({
    signature,
    raw_body_bytes: enc.encode(raw_body).length,
    http_status: httpStatus,
    response_text: responseText,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
