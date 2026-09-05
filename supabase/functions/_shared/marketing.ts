// Marketing shared module for the Growth Engine.
// Pure helpers + a few DB readers shared across campaign-engine, growth-hub,
// lead-nurture, optimize-posting and competitor-watch edge functions.
// All AI generation goes through geminiChatWithFallback (AGENTS.md rule #1).

import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from "./gemini-client.ts";
import { extractJson } from "./company-context.ts";

export interface BrandKit {
  logo_url?: string | null;
  colors?: Record<string, any>;
  tone?: string | null;
  fonts?: Record<string, any>;
  no_go_phrases?: string | null;
  guidelines?: string | null;
}

export type Playbook =
  | "flash_sale" | "launch" | "restock" | "seasonal" | "new_branch" | "awareness" | "custom";

export interface PlaybookTemplate {
  key: Playbook;
  label: string;
  objective: string;
  funnelStage: "top" | "middle" | "bottom";
  copyBrief: string;
  hooks: string[];
  bestTime: string;
}

/** Curated marketing playbooks the agent runs on command. */
export const PLAYBOOKS: Record<Exclude<Playbook, "custom">, PlaybookTemplate> = {
  flash_sale: {
    key: "flash_sale", label: "Flash Sale", objective: "Drive urgency + sales", funnelStage: "bottom",
    copyBrief: "Urgent, limited-time discount with scarcity and a clear deadline + CTA.",
    hooks: ["Limited time only…", "48 hours. That's it.", "We're clearing the shelves — you benefit"],
    bestTime: "Thu–Sat, 18:00–21:00 local",
  },
  launch: {
    key: "launch", label: "Product / Service Launch", objective: "Awareness + first orders", funnelStage: "top",
    copyBrief: "Introduce something new with a story, a benefit, and a strong hook.",
    hooks: ["Meet the new…", "It's finally here.", "You asked. We built it."],
    bestTime: "Wed, 10:00–12:00 local",
  },
  restock: {
    key: "restock", label: "Restock Alert", objective: "Convert waiting customers", funnelStage: "bottom",
    copyBrief: "Announce availability of an in-demand item and prompt immediate action.",
    hooks: ["Back in stock.", "It sold out before — don't wait.", "Your size is back."],
    bestTime: "Mon–Fri, 12:00–13:00 local",
  },
  seasonal: {
    key: "seasonal", label: "Seasonal / Holiday", objective: "Timely relevance", funnelStage: "middle",
    copyBrief: "Tie the offer to a season, holiday, or local calendar moment.",
    hooks: ["This season, treat yourself to…", "Holiday-ready."],
    bestTime: "1–2 weeks before the event, 17:00–19:00",
  },
  new_branch: {
    key: "new_branch", label: "New Branch / Location", objective: "Local awareness", funnelStage: "top",
    copyBrief: "Announce a new location with opening hours, address, and a welcome offer.",
    hooks: ["We've just opened in…", "Now serving you at…"],
    bestTime: "Fri–Sat, 10:00–12:00",
  },
  awareness: {
    key: "awareness", label: "Brand Awareness", objective: "Reach + recall", funnelStage: "top",
    copyBrief: "Story-led, values-driven content that builds familiarity, not a hard sell.",
    hooks: ["This is who we are.", "Why we do what we do."],
    bestTime: "Tue–Thu, 09:00–11:00",
  },
};

export function getPlaybook(p: string | null | undefined): PlaybookTemplate {
  const key = (p || "custom").toLowerCase();
  if (key in PLAYBOOKS) return (PLAYBOOKS as any)[key];
  return { key: "custom", label: "Custom", objective: "Custom", funnelStage: "middle", copyBrief: "Follow the owner's brief.", hooks: [], bestTime: "Anytime" };
}

/** Build a brand block for injecting into AI prompts (on-brand guardrail). */
export function buildBrandBlock(kit: BrandKit | null | undefined): string {
  if (!kit) return "";
  const parts: string[] = [];
  if (kit.tone) parts.push("BRAND TONE: " + kit.tone);
  if (kit.guidelines) parts.push("BRAND GUIDELINES: " + kit.guidelines.slice(0, 800));
  if (kit.colors && typeof kit.colors === "object") {
    const c = Object.entries(kit.colors).map(([k, v]) => k + "=" + String(v)).join(", ");
    if (c) parts.push("BRAND COLORS: " + c);
  }
  const noGo = (kit.no_go_phrases || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (noGo.length) parts.push("NEVER USE: " + noGo.slice(0, 30).join(", "));
  return parts.join("\n");
}

/** Deterministic low-risk lead score from conversation/post signals (0-100). */
export function scoreLead(raw: any): number {
  const text = String(raw?.text || raw?.content || "").toLowerCase();
  const s = raw?.signals || {};
  let score = 0;
  const price = /price|cost|how much|ks?\d|kwacha|quote|bill|rate/.test(text);
  const buy = /buy|order|book|reserve|purchase|subscribe|get one|i want|available|in stock/.test(text);
  const urgent = /urgent|asap|today|now|emergency|delivery/.test(text);
  const size = /how many|quantity|do you have|large|size|stock/.test(text);
  const business = /business|company|bulk|wholesale|supply|contract|project/.test(text);
  const returning = /again|usually|repeat|previous|before/.test(text);
  const question = /\?|what|when|where|which|can you/.test(text);
  if (price) score += 25;
  if (buy) score += 25;
  if (urgent) score += 15;
  if (size) score += 12;
  if (business) score += 10;
  if (returning) score += 8;
  if (question) score += 5;
  if (s?.engaged || s?.answered) score += 8;
  if (s?.satisfied || s?.positive) score += 7;
  if (s?.unanswered) score -= 10;
  return Math.max(0, Math.min(100, score));
}

export function leadTier(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

/** Best time to post for a company (learns later; sensible default now). */
export function bestTimeToPost(company: any): { date: string; time: string; reason: string } {
  const defaultDay = "Thu";
  const defaultTime = "18:00";
  return {
    date: defaultDay,
    time: defaultTime,
    reason: "Evening local time, end of the business week — highest engagement for local audiences.",
  };
}

/** Generate N on-brand creative variants for a campaign. Pure AI call. */
export async function generateVariants(opts: {
  brief: string;
  brandBlock: string;
  template: PlaybookTemplate;
  count?: number;
  channels?: string[];
}): Promise<Array<{ label: string; content: string; hook: string; channel: string }>> {
  const count = opts.count || 3;
  const channels = opts.channels?.length ? opts.channels : ["facebook", "instagram"];
  const sys = [
    "You are a senior social media creative director for an African SME.",
    opts.brandBlock || "",
    "Generate " + count + " DISTINCT creative variants for this campaign. Each is a ready-to-publish social post.",
    "Objective: " + opts.template.objective + ". Strategy: " + opts.template.copyBrief,
    "Vary the hook, angle, and tone in each variant — do not repeat the same idea.",
    "Keep each caption 1-4 sentences, PLAIN TEXT only (no markdown, no bullets, no emoji overload).",
    "Include a strong first-line hook.",
    "Reply with ONLY a JSON array. Each item: {\"label\":\"Variant A\",\"content\":\"...\",\"hook\":\"...\",\"channel\":\"facebook\"} where channel is one of " + channels.join(" or ") + ".",
  ].filter(Boolean).join("\n");
  const ai = await geminiChatWithFallback({
    model: PRIMARY_TEXT_MODEL,
    messages: [{ role: "system", content: sys }, { role: "user", content: "Brief: " + opts.brief }],
    temperature: 0.85,
    max_tokens: 1500,
  });
  const data: any = await ai.json().catch(() => ({}));
  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  let arr: any[] | null = null;
  try { arr = JSON.parse(text); } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) { try { arr = JSON.parse(m[0]); } catch { arr = null; } }
  }
  if (!Array.isArray(arr) || !arr.length) {
    // Robust fallback: one variant from the brief so we still make progress.
    return [{ label: "Variant A", content: opts.brief, hook: opts.template.hooks[0] || "", channel: channels[0] }];
  }
  return arr.slice(0, count).map((v: any, i: number) => ({
    label: v?.label || ("Variant " + String.fromCharCode(65 + i)),
    content: String(v?.content || opts.brief).trim(),
    hook: String(v?.hook || (opts.template.hooks[0] || "")).trim(),
    channel: String(v?.channel || channels[0]).toLowerCase() === "instagram" ? "instagram" : "facebook",
  }));
}

/** Generate a short AI marketing summary from a metrics object. */
export async function generateGrowthSummary(companyName: string, metrics: any): Promise<string> {
  const sys = [
    "You are a growth analyst for " + companyName + ".",
    "Summarize this week's marketing performance in 3-4 short, plain-text sentences (no markdown, no bullets).",
    "Call out the single biggest win and one clear recommendation for next week.",
    "Be specific with numbers. Do not invent figures not provided.",
  ].join("\n");
  const ai = await geminiChatWithFallback({
    model: PRIMARY_TEXT_MODEL,
    messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(metrics).slice(0, 4000) }],
    temperature: 0.4,
    max_tokens: 500,
  });
  const data: any = await ai.json().catch(() => ({}));
  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  return text || "Your accounts are active this week. Check the scoreboard for the latest numbers.";
}

export { extractJson };
