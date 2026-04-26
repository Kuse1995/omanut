import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders, assertOwner, loadCredential, metaFetch, META_GRAPH, humanizeMetaError } from "../_shared/meta-ads.ts";

interface Body {
  credential_id: string;
  company_id: string;
  ad_account_id?: string; // optional — verify a candidate id before saving
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    if (ctx instanceof Response) return ctx;

    const body = (await req.json()) as Body;
    if (!body.credential_id || !body.company_id) {
      return new Response(JSON.stringify({ error: 'credential_id and company_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ctx.isServiceRole && !(await assertOwner(ctx.supabase, ctx.userId, body.company_id))) {
      return new Response(JSON.stringify({ error: 'Only company owners can manage ads.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cred = await loadCredential(ctx.supabase, body.credential_id, body.company_id);
    if (!cred) {
      return new Response(JSON.stringify({ error: 'Credential not found.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adAccountId = (body.ad_account_id || cred.ad_account_id || '').trim();
    const result: any = {
      ad_account_id: adAccountId || null,
      token_ok: false,
      has_ads_management: false,
      has_ads_read: false,
      ad_account_active: false,
      ad_account_currency: null,
      has_funding_source: false,
      issues: [] as string[],
    };

    // 1. Token validity + permissions
    const perms = await metaFetch(`${META_GRAPH}/me/permissions?access_token=${encodeURIComponent(cred.access_token)}`);
    if (!perms.ok) {
      result.issues.push(humanizeMetaError(perms.json));
    } else {
      result.token_ok = true;
      const granted = (perms.json?.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
      result.has_ads_management = granted.includes('ads_management');
      result.has_ads_read = granted.includes('ads_read') || result.has_ads_management;
      if (!result.has_ads_management) result.issues.push('Token is missing the `ads_management` scope. Reconnect with Marketing API permissions.');
    }

    // 2. Ad account status
    if (adAccountId) {
      const acctId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      const acct = await metaFetch(`${META_GRAPH}/${acctId}?fields=account_status,currency,funding_source,name,disable_reason&access_token=${encodeURIComponent(cred.access_token)}`);
      if (!acct.ok) {
        result.issues.push(humanizeMetaError(acct.json));
      } else {
        result.ad_account_active = acct.json.account_status === 1;
        result.ad_account_currency = acct.json.currency || null;
        result.has_funding_source = !!acct.json.funding_source;
        result.ad_account_name = acct.json.name || null;
        if (!result.ad_account_active) result.issues.push(`Ad account is not active (status=${acct.json.account_status}).`);
        if (!result.has_funding_source) result.issues.push('Ad account has no payment method. Add one in Meta Business Manager → Billing.');
      }
    } else {
      result.issues.push('No ad account ID set. Paste your `act_XXXX` ID and verify.');
    }

    result.ready = result.token_ok && result.has_ads_management && result.ad_account_active && result.has_funding_source;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[meta-ads-verify]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
