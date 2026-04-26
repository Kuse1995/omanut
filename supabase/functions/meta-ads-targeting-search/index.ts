import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders, loadCredential, metaFetch, META_GRAPH, humanizeMetaError } from "../_shared/meta-ads.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    if (ctx instanceof Response) return ctx;

    const { credential_id, company_id, query } = await req.json();
    if (!credential_id || !company_id || !query) {
      return new Response(JSON.stringify({ error: 'credential_id, company_id, query required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cred = await loadCredential(ctx.supabase, credential_id, company_id);
    if (!cred) {
      return new Response(JSON.stringify({ error: 'Credential not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = `${META_GRAPH}/search?type=adinterest&q=${encodeURIComponent(query)}&limit=20&access_token=${encodeURIComponent(cred.access_token)}`;
    const { ok, json } = await metaFetch(url);
    if (!ok) {
      return new Response(JSON.stringify({ error: humanizeMetaError(json) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const interests = (json?.data || []).map((i: any) => ({ id: i.id, name: i.name, audience_size: i.audience_size }));
    return new Response(JSON.stringify({ interests }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
