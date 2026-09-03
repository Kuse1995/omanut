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