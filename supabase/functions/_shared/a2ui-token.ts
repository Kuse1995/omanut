import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type A2UISurfaceType =
  | 'vault_uploader'
  | 'vault_prioritizer'
  | 'calendar_grid'
  | 'creative_studio'
  | 'connect_hub'
  | 'brand_dna'
  | 'onboarding_hub';

export interface A2UITokenPayload {
  sid: string;
  cid: string;
  ph: string;
  st: A2UISurfaceType;
  exp: number;
}

export interface A2UISessionRow {
  id: string;
  company_id: string;
  phone: string;
  token_hash: string;
  surface_type: A2UISurfaceType;
  ui_spec: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
  status: 'active' | 'submitted' | 'expired';
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getSecret(): Promise<string> {
  const configured =
    Deno.env.get('A2UI_TOKEN_SECRET') ||
    Deno.env.get('SOCIAL_OAUTH_STATE_SECRET') ||
    '';
  if (configured.trim().length >= 16) return configured.trim();
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'omanut-a2ui-fallback';
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`a2ui:${srk}`));
  return b64url(new Uint8Array(digest));
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mintA2UIToken(payload: A2UITokenPayload): Promise<{
  token: string;
  tokenHash: string;
}> {
  const secret = await getSecret();
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, `m:${body}`);
  const token = `${body}.${sig}`;
  const tokenHash = await sha256Hex(token);
  return { token, tokenHash };
}

export async function verifyA2UIToken(
  supabase: SupabaseClient,
  rawToken: string
): Promise<{
  valid: true;
  session: A2UISessionRow;
  companyId: string;
  phone: string;
} | { valid: false; reason: string }> {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length > 2048) {
    return { valid: false, reason: 'Invalid token format' };
  }
  const parts = rawToken.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'Malformed token' };
  }

  const secret = await getSecret();
  const expected = await hmacSign(secret, `m:${parts[0]}`);
  if (expected.length !== parts[1].length) {
    return { valid: false, reason: 'Invalid token signature' };
  }
  let diff = 0;
  for (let i = 0; i < parts[1].length; i++) {
    diff |= expected.charCodeAt(i) ^ parts[1].charCodeAt(i);
  }
  if (diff !== 0) {
    return { valid: false, reason: 'Token signature mismatch' };
  }

  let parsed: A2UITokenPayload;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  } catch {
    return { valid: false, reason: 'Unreadable token payload' };
  }

  if (!parsed?.sid || !parsed?.cid || !parsed?.exp || parsed.exp < Date.now()) {
    return { valid: false, reason: 'This studio link has expired. Ask your Omanut Marketer for a fresh link.' };
  }

  const tokenHash = await sha256Hex(rawToken.trim());
  const { data: session, error } = await supabase
    .from('a2ui_sessions')
    .select('*')
    .eq('id', parsed.sid)
    .eq('company_id', parsed.cid)
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !session) {
    return { valid: false, reason: 'Studio session not found' };
  }

  if (Date.parse(session.expires_at) < Date.now() || session.status === 'expired') {
    return { valid: false, reason: 'This studio link has expired. Ask your Omanut Marketer for a fresh link.' };
  }

  return {
    valid: true,
    session: session as A2UISessionRow,
    companyId: session.company_id,
    phone: session.phone,
  };
}

export async function createSignedA2UISession(
  supabase: SupabaseClient,
  opts: {
    companyId: string;
    phone: string;
    surfaceType: A2UISurfaceType;
    uiSpec?: Record<string, unknown>;
    ttlHours?: number;
  }
): Promise<{ sessionId: string; token: string; url: string; expiresAt: string }> {
  const id = crypto.randomUUID();
  const ttlMs = Math.max(1, opts.ttlHours ?? (opts.surfaceType === 'vault_uploader' || opts.surfaceType === 'onboarding_hub' ? 24 : 4)) * 3600 * 1000;
  const exp = Date.now() + ttlMs;
  const expiresAt = new Date(exp).toISOString();

  const { token, tokenHash } = await mintA2UIToken({
    sid: id,
    cid: opts.companyId,
    ph: opts.phone,
    st: opts.surfaceType,
    exp,
  });

  const { error } = await supabase.from('a2ui_sessions').insert({
    id,
    company_id: opts.companyId,
    phone: opts.phone,
    token_hash: tokenHash,
    surface_type: opts.surfaceType,
    ui_spec: opts.uiSpec ?? {},
    status: 'active',
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Failed to create A2UI session: ${error.message}`);
  }

  return {
    sessionId: id,
    token,
    url: buildStudioUrl(token, surfaceTabFor(opts.surfaceType)),
    expiresAt,
  };
}

export function surfaceTabFor(surfaceType: A2UISurfaceType): string {
  switch (surfaceType) {
    case 'vault_uploader':
      return 'vault';
    case 'vault_prioritizer':
      return 'prioritize';
    case 'calendar_grid':
      return 'calendar';
    case 'creative_studio':
      return 'studio';
    case 'connect_hub':
      return 'connect';
    case 'brand_dna':
      return 'brand';
    case 'onboarding_hub':
      return 'connect';
    default:
      return 'vault';
  }
}

export function buildStudioUrl(token: string, tab?: string): string {
  const origin = (Deno.env.get('PUBLIC_APP_URL') || 'https://assistant.omanut.me').replace(/\/+$/, '');
  return `${origin}/m/${token}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`;
}
