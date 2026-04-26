// Shared helpers for Facebook Ads (Marketing API) edge functions
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const META_GRAPH_VERSION = 'v21.0';
export const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

export interface AuthContext {
  userId: string;
  isServiceRole: boolean;
  supabase: SupabaseClient;        // service-role client
  userClient: SupabaseClient;       // user-scoped client (RLS-aware)
}

export async function authenticate(req: Request): Promise<AuthContext | Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  const isServiceRole = token === supabaseServiceKey;

  if (isServiceRole) {
    return { userId: '', isServiceRole: true, supabase, userClient: supabase };
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return { userId: user.id, isServiceRole: false, supabase, userClient };
}

/** Returns true if the calling user is an owner of the company. Always trusts the DB. */
export async function assertOwner(supabase: SupabaseClient, userId: string, companyId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !data) return false;
  return data.role === 'owner';
}

export async function loadCredential(supabase: SupabaseClient, credentialId: string, companyId: string) {
  const { data, error } = await supabase
    .from('meta_credentials')
    .select('id, page_id, access_token, ad_account_id, company_id')
    .eq('id', credentialId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/** Translate Meta API error codes into actionable messages. */
export function humanizeMetaError(payload: any): string {
  const err = payload?.error || payload;
  const code = err?.code;
  const sub = err?.error_subcode;
  const msg = err?.message || 'Unknown Meta error';
  switch (code) {
    case 190:
      return 'Access token is invalid or expired. Please reconnect this Facebook page.';
    case 200:
      return `Permission denied. The token is missing the required ads scope. (${msg})`;
    case 100:
      return `Invalid request to Meta: ${msg}`;
    case 2635:
      return 'Your ad account has no payment method. Add one in Meta Business Manager → Billing.';
    case 17:
    case 4:
    case 32:
      return 'Meta API rate limit hit. Please wait a few minutes and try again.';
    default:
      return `Meta error${code ? ` ${code}` : ''}${sub ? `/${sub}` : ''}: ${msg}`;
  }
}

export async function metaFetch(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, json };
}

export async function logAudit(
  supabase: SupabaseClient,
  companyId: string,
  campaignId: string | null,
  actorUserId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  await supabase.from('meta_ad_audit_log').insert({
    company_id: companyId,
    campaign_id: campaignId,
    actor_user_id: actorUserId || null,
    action,
    before_state: before as any,
    after_state: after as any,
  });
}

/** Hard daily-budget cap to prevent runaway spend from typos. */
export const MAX_DAILY_BUDGET_CENTS = 1_000_000; // 10,000.00 in any currency
