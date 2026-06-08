// Inert stub. OpenClaw was removed; MiniMax handles every channel in-house.
// Kept as a no-op so existing imports across edge functions keep compiling.

export type OpenclawSkill =
  | 'whatsapp' | 'meta_dm' | 'comments' | 'bms' | 'content' | 'handoff';

export interface GateContext {
  conversation_id?: string;
  channel?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
}

export interface GateResult {
  delegated: false;
  reason?: string;
  response?: undefined;
}

export async function isOwnedByOpenclaw(
  _supabase: any, _companyId: string, _skill: OpenclawSkill,
): Promise<boolean> {
  return false;
}

export async function gateSkill(
  _supabase: any, _companyId: string, _skill: OpenclawSkill, _ctx: GateContext = {},
): Promise<GateResult> {
  return { delegated: false };
}
