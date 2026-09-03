// Company Brain — shared grounding context for every channel worker
// (FB/IG comments, FB/IG DMs; WhatsApp keeps its own richer in-function
// pipeline). The goal: an AI that answers FROM the company's knowledge,
// the live conversation, and the actual post — never from thin air.
//
// All builders are failure-tolerant: any missing piece degrades gracefully
// and the caller falls back to the bare inbound text.
//
// Pricing note: keep PRODUCT/SERVICES facts in the INPUT so the harness
// price guard (llm_price_invention) allows quoting real prices.

export interface CompanyFacts {
  voice_style?: string | null;
  hours?: string | null;
  services?: string | null;
  quick_reference_info?: string | null;
}

// Authoritative company facts block (KB grounding). Long fields are capped
// so the harness call stays fast (client timeout is 12s by default).
export function buildCompanyFacts(company: CompanyFacts | null | undefined): string {
  return [
    company?.voice_style ? "BRAND VOICE: " + company.voice_style : "",
    company?.hours ? "BUSINESS HOURS: " + company.hours : "",
    company?.services ? "PRODUCTS/SERVICES (only quote prices that appear here): " + String(company.services).slice(0, 1500) : "",
    company?.quick_reference_info ? "QUICK FACTS: " + String(company.quick_reference_info).slice(0, 1200) : "",
  ].filter(Boolean).join("\n");
}

// Public comment context: the post being commented on (Graph, via the page
// token), the parent comment when the comment is a reply-to-reply, and the
// commenter's recent comments on that post (thread continuity).
export async function buildCommentContext(supabase: any, payload: any): Promise<string> {
  const parts: string[] = [];
  try {
    if (payload.page_id && payload.post_id) {
      const { data: cred } = await supabase
        .from("meta_credentials")
        .select("access_token")
        .eq("page_id", payload.page_id)
        .maybeSingle();
      if (cred?.access_token) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(
          "https://graph.facebook.com/v21.0/" + payload.post_id + "?fields=message&access_token=" + encodeURIComponent(cred.access_token),
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        const j: any = await res.json().catch(() => ({}));
        if (j?.message) parts.push("THE POST THEY ARE COMMENTING ON:\n\"" + String(j.message).slice(0, 800) + "\"");
      }
    }
  } catch { /* post context is optional */ }
  try {
    if (payload.parent_comment_id) {
      const { data: parent } = await supabase
        .from("facebook_comments")
        .select("comment_text, commenter_name")
        .eq("comment_id", payload.parent_comment_id)
        .maybeSingle();
      if (parent?.comment_text) parts.push("THEY ARE REPLYING TO THIS COMMENT by " + (parent.commenter_name || "someone") + ":\n\"" + String(parent.comment_text).slice(0, 400) + "\"");
    }
  } catch { /* optional */ }
  try {
    if (payload.post_id && payload.commenter_id) {
      const { data: prior } = await supabase
        .from("facebook_comments")
        .select("comment_text, created_at")
        .eq("post_id", payload.post_id)
        .eq("commenter_id", payload.commenter_id)
        .order("created_at", { ascending: false })
        .limit(6);
      const items = (prior || []).filter((c: any) => c.comment_text).slice(0, 5);
      if (items.length) parts.push("THIS PERSON'S RECENT COMMENTS ON THIS POST (newest first):\n" + items.map((c: any, i: number) => (i + 1) + ". \"" + String(c.comment_text).slice(0, 200) + "\"").join("\n"));
    }
  } catch { /* optional */ }
  return parts.join("\n\n");
}

// DM context: recent conversation turns. The current inbound turn is
// expected to already be persisted (meta-webhook v2) and is dropped from
// the history (it arrives separately via the user prompt).
export async function buildDmContext(supabase: any, payload: any, currentText: string): Promise<string> {
  if (!payload.conversation_id) return "";
  try {
    const { data: history } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", payload.conversation_id)
      .order("created_at", { ascending: false })
      .limit(12);
    const items = (history || []).filter((m: any) => m.content);
    if (items.length && items[0].role === "user" && String(items[0].content) === currentText) items.shift();
    const ordered = items.reverse().slice(-10);
    if (!ordered.length) return "";
    return "CONVERSATION SO FAR:\n" + ordered.map((m: any) => (m.role === "user" ? "Customer: " : "You: ") + String(m.content).slice(0, 300)).join("\n");
  } catch { return ""; }
}

// ── Knowledge Base search (strict grounding) ────────────────────────────
// Keyword-scored search across the company's ENTIRE knowledge estate:
// curated KB fields, payment instructions, BMS catalog snapshot, and
// uploaded documents. Returns ranked, source-tagged snippets. Every
// channel injects the top matches into its system prompt so replies are
// grounded STRICTLY in company knowledge (and the harness price guard
// then allows exactly those prices).

export interface KbSnippet {
  source: string;
  snippet: string;
  score: number;
}

export async function searchKnowledgeBase(
  supabase: any,
  companyId: string,
  query: string,
  limit = 6,
): Promise<KbSnippet[]> {
  const q = String(query ?? "").trim();
  if (!q) return [];
  try {
    const [{ data: company }, { data: docs }, { data: bmsRow }] = await Promise.all([
      supabase.from("companies").select("quick_reference_info, payment_instructions, services, hours, branches, service_locations").eq("id", companyId).maybeSingle(),
      supabase.from("company_documents").select("filename, parsed_content").eq("company_id", companyId).limit(20),
      supabase.from("bms_connections").select("last_kb_text").eq("company_id", companyId).eq("is_active", true).maybeSingle(),
    ]);

    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const matches: KbSnippet[] = [];
    const scan = (source: string, text: string | null | undefined) => {
      if (!text) return;
      const paragraphs = String(text).split(/\n{2,}|\r\n\r\n/);
      for (const p of paragraphs) {
        const lower = p.toLowerCase();
        let score = 0;
        for (const t of terms) if (lower.includes(t)) score++;
        if (score > 0) matches.push({ source, snippet: p.trim().slice(0, 800), score });
      }
    };

    scan("quick_reference_info", company?.quick_reference_info);
    scan("payment_instructions", company?.payment_instructions);
    scan("services", company?.services);
    scan("hours", company?.hours);
    scan("branches", company?.branches);
    scan("service_locations", company?.service_locations);
    scan("bms_catalog", bmsRow?.last_kb_text);
    for (const d of docs ?? []) scan("document:" + (d.filename || "doc"), d.parsed_content);

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  } catch {
    return [];
  }
}

// Format KB snippets as a system-prompt block.
export function formatKbMatches(matches: KbSnippet[]): string {
  if (!matches.length) return "";
  return "KNOWLEDGE BASE MATCHES (authoritative — quote only prices/details that appear here):\n" +
    matches.map((m, i) => (i + 1) + ". [" + m.source + "] " + m.snippet).join("\n");
}

// ── Conversational onboarding: the agent WRITES the company profile ─────
// The owner chats; the agent extracts facts and saves them here. The
// whitelisted fields are exactly what the company form edits — nothing
// billing/infra related is reachable from chat.

export const AGENT_FACT_FIELDS = [
  "name", "industry", "business_type", "voice_style", "hours",
  "services", "branches", "service_locations", "currency_prefix",
  "quick_reference_info", "payment_instructions",
] as const;

export function profileStatus(company: any): { field: string; label: string; set: boolean }[] {
  return AGENT_FACT_FIELDS.map((f) => ({
    field: f,
    label: f.replace(/_/g, " "),
    set: !!(company && String(company[f] || "").trim()),
  }));
}

export function profileMissingList(company: any): string[] {
  return profileStatus(company).filter((p) => !p.set).map((p) => p.label);
}

export function sanitizeFacts(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const f of AGENT_FACT_FIELDS) {
    if (raw[f] !== undefined && raw[f] !== null) {
      out[f] = String(raw[f]).slice(0, 4000).trim();
    }
  }
  return out;
}

export async function updateCompanyFacts(supabase: any, companyId: string, raw: any): Promise<{ saved: string[] }> {
  const patch = sanitizeFacts(raw);
  const saved = Object.keys(patch);
  if (saved.length) {
    const { error } = await supabase.from("companies").update(patch).eq("id", companyId);
    if (error) throw new Error("Company update failed: " + error.message);
  }
  return { saved };
}

export async function upsertKbDocument(supabase: any, companyId: string, filename: string, content: string): Promise<void> {
  const cleanName = String(filename || "").trim().slice(0, 120) || ("kb-" + Date.now() + ".md");
  const cleanContent = String(content || "").slice(0, 40000);
  const { data: existing } = await supabase
    .from("company_documents")
    .select("id")
    .eq("company_id", companyId)
    .eq("filename", cleanName)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from("company_documents").update({ parsed_content: cleanContent }).eq("id", existing.id);
    if (error) throw new Error("KB update failed: " + error.message);
  } else {
    const { error } = await supabase.from("company_documents").insert({
      company_id: companyId, filename: cleanName, parsed_content: cleanContent,
    });
    if (error) throw new Error("KB insert failed: " + error.message);
  }
}

// Meta OAuth connect URL — mirrors MetaIntegrationsPanel exactly
// (Facebook Login for Business requires response_type=code; the JS SDK
// would force response_type=token, so we build the dialog URL ourselves).
export function buildMetaConnectUrl(
  origin: string, appId: string, configId: string | null | undefined, state: string,
): string {
  const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  if (configId) url.searchParams.set("config_id", configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", origin.replace(/\/+$/, "") + "/auth/meta/callback");
  url.searchParams.set("state", state);
  url.searchParams.set("scope",
    "pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging," +
    "pages_manage_posts,instagram_basic,instagram_manage_messages," +
    "instagram_manage_comments,instagram_content_publish,business_management");
  return url.toString();
}