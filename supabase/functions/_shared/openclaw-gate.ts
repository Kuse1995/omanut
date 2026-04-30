// Shared OpenClaw skill-gating helper.
// Used by tool runners (BMS, content, image gen, handoff, etc.) to decide whether a skill
// should execute internally or be delegated to OpenClaw.
//
// Usage at the entry of any tool runner:
//   import { gateSkill } from '../_shared/openclaw-gate.ts';
//   const gate = await gateSkill(supabase, companyId, 'bms', { conversation_id, payload });
//   if (gate.delegated) return gate.response;   // bail; OpenClaw will handle it
//
// The helper logs an `openclaw_events` row + POSTs to the company's webhook via the
// `openclaw-dispatch` edge function so OpenClaw sees the request immediately.

export type OpenclawSkill =
  | 'whatsapp'
  | 'meta_dm'
  | 'comments'
  | 'bms'
  | 'content'
  | 'handoff';

export interface GateContext {
  conversation_id?: string;
  channel?: string;          // optional: defaults to skill name
  event_type?: string;       // optional: defaults to `skill_request`
  payload?: Record<string, unknown>;
}

export interface GateResult {
  delegated: boolean;
  reason?: string;
  response?: { status: 'delegated_to_openclaw'; skill: OpenclawSkill; event_id?: string };
}

interface CompanyConfigRow {
  openclaw_mode: 'off' | 'assist' | 'primary' | null;
  openclaw_owns: Record<string, boolean> | null;
}

export async function isOwnedByOpenclaw(
  supabase: any,
  companyId: string,
  skill: OpenclawSkill,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('companies')
    .select('openclaw_mode, openclaw_owns')
    .eq('id', companyId)
    .maybeSingle();
  if (error || !data) return false;
  const row = data as CompanyConfigRow;
  return row.openclaw_mode === 'primary' && row.openclaw_owns?.[skill] === true;
}

export async function gateSkill(
  supabase: any,
  companyId: string,
  skill: OpenclawSkill,
  ctx: GateContext = {},
): Promise<GateResult> {
  if (!companyId) return { delegated: false };

  const owned = await isOwnedByOpenclaw(supabase, companyId, skill);
  if (!owned) return { delegated: false };

  // Fire-and-forget dispatch so callers stay snappy. We do await invoke, but
  // openclaw-dispatch itself caps the outbound HTTP at 10s.
  let eventId: string | undefined;
  try {
    const { data, error } = await supabase.functions.invoke('openclaw-dispatch', {
      body: {
        company_id: companyId,
        channel: ctx.channel ?? skill,
        event_type: ctx.event_type ?? 'skill_request',
        skill,
        conversation_id: ctx.conversation_id,
        payload: ctx.payload ?? {},
      },
    });
    if (error) {
      console.error('[openclaw-gate] dispatch error', skill, error.message);
    } else {
      eventId = (data as any)?.event_id;
    }
  } catch (e) {
    console.error('[openclaw-gate] dispatch threw', skill, e);
  }

  return {
    delegated: true,
    reason: `openclaw_owns_${skill}`,
    response: { status: 'delegated_to_openclaw', skill, event_id: eventId },
  };
}

// Heartbeat bump — call from MCP tool wrappers so any OpenClaw activity proves liveness.
export async function bumpHeartbeat(supabase: any, companyId: string | null | undefined): Promise<void> {
  if (!companyId) return;
  try {
    await supabase
      .from('companies')
      .update({ openclaw_last_heartbeat: new Date().toISOString() })
      .eq('id', companyId);
  } catch (e) {
    console.error('[openclaw-gate] heartbeat bump failed', e);
  }
}
