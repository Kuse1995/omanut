// Persona cache helpers. Persona is shipped once per conversation; subsequent
// envelopes carry only { company_id, persona_key }. When the owner edits
// company_ai_overrides, a trigger bumps persona_version which changes the key
// and forces a re-send.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface PersonaBlock {
  system_instructions: string | null;
  tone_voice_guide: string | null;
  escalation_triggers: string[];
  qa_style: string | null;
  banned_topics: string | null;
  voice_style: string | null;
  agent_modes: Array<{
    slug: string;
    name: string;
    system_prompt: string | null;
    trigger_keywords: string[] | null;
    enabled: boolean;
    is_default: boolean;
    priority: number;
  }>;
}

export interface PersonaEnvelope {
  persona_key: string;
  persona_version: number;
  persona: PersonaBlock;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildPersonaEnvelope(
  sb: SupabaseClient,
  companyId: string,
): Promise<PersonaEnvelope> {
  const [{ data: ov }, { data: modes }] = await Promise.all([
    sb.from("company_ai_overrides")
      .select(
        "system_instructions, tone_voice_guide, escalation_triggers, qa_style, banned_topics, voice_style, persona_version",
      )
      .eq("company_id", companyId)
      .maybeSingle(),
    sb.from("company_agent_modes")
      .select("slug, name, system_prompt, trigger_keywords, enabled, is_default, priority")
      .eq("company_id", companyId)
      .order("priority", { ascending: true }),
  ]);

  const persona: PersonaBlock = {
    system_instructions: ov?.system_instructions ?? null,
    tone_voice_guide: ov?.tone_voice_guide ?? null,
    escalation_triggers: (ov?.escalation_triggers as string[] | null) ?? [],
    qa_style: ov?.qa_style ?? null,
    banned_topics: ov?.banned_topics ?? null,
    voice_style: ov?.voice_style ?? null,
    agent_modes: (modes as PersonaBlock["agent_modes"] | null) ?? [],
  };

  const persona_version = (ov?.persona_version as number | null) ?? 1;
  const persona_key = await sha256Hex(
    `${companyId}:${persona_version}:${JSON.stringify(persona)}`,
  );

  return { persona_key, persona_version, persona };
}

/**
 * Write persona_key onto conversations.metadata. Use after handshake so that
 * subsequent envelope-builds can detect cache invalidation.
 */
export async function setConversationPersonaKey(
  sb: SupabaseClient,
  conversationId: string,
  personaKey: string,
): Promise<void> {
  const { data: row } = await sb
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const metadata = (row?.metadata as Record<string, unknown> | null) ?? {};
  metadata.persona_key = personaKey;
  await sb.from("conversations").update({ metadata }).eq("id", conversationId);
}

/**
 * For envelope builders. Given the conversation, return either:
 *  - { persona_invalidated: true, ...PersonaEnvelope } if cached key is stale
 *  - { persona_invalidated: false, persona_key }       to keep payload small
 */
export async function resolvePersonaForEnvelope(
  sb: SupabaseClient,
  companyId: string,
  conversationId: string | null,
): Promise<
  | ({ persona_invalidated: true } & PersonaEnvelope)
  | { persona_invalidated: false; persona_key: string }
> {
  const env = await buildPersonaEnvelope(sb, companyId);

  if (!conversationId) {
    return { persona_invalidated: true, ...env };
  }

  const { data: row } = await sb
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const cached = (row?.metadata as Record<string, unknown> | null)?.persona_key as
    | string
    | undefined;

  if (cached === env.persona_key) {
    return { persona_invalidated: false, persona_key: env.persona_key };
  }
  await setConversationPersonaKey(sb, conversationId, env.persona_key);
  return { persona_invalidated: true, ...env };
}
