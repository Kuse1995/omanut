// Librarian: pulls company-scoped rules + facts relevant to the IntentObject.
// Reads company_ai_overrides + companies.quick_reference_info (BMS block) directly.
// Returns a compact RuleSet — never the full KB.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { IntentObject, RuleSet, SwarmInput } from './types.ts';

export async function runLibrarian(
  supabase: ReturnType<typeof createClient>,
  input: SwarmInput,
  intent: IntentObject,
): Promise<{ rules: RuleSet; ms: number; model: string }> {
  const start = Date.now();

  const [companyRes, aiRes] = await Promise.all([
    supabase
      .from('companies')
      .select('name, business_type, services, hours, quick_reference_info, metadata')
      .eq('id', input.company_id)
      .maybeSingle(),
    supabase
      .from('company_ai_overrides')
      .select('system_instructions, banned_topics, qa_style, fallback_message')
      .eq('company_id', input.company_id)
      .maybeSingle(),
  ]);

  const company: any = companyRes.data || {};
  const ai: any = aiRes.data || {};

  const must_do: string[] = [];
  const must_not: string[] = [];

  // Brand voice
  const brand_voice = (ai.qa_style || 'Professional, warm, concise. First-person plural ("we").').toString();

  // Banned topics → must_not
  if (ai.banned_topics) {
    String(ai.banned_topics)
      .split(/[\n,;]+/)
      .map((s: string) => s.trim())
      .filter(Boolean)
      .forEach((t: string) => must_not.push(`Do not discuss: ${t}`));
  }

  // System instructions split into bullets
  if (ai.system_instructions) {
    String(ai.system_instructions)
      .split(/\n+/)
      .map((s: string) => s.trim().replace(/^[-•*]\s*/, ''))
      .filter((s: string) => s.length > 4)
      .slice(0, 12)
      .forEach((s: string) => must_do.push(s));
  }

  // Hard universal rules
  must_not.push('Do not invent prices or stock — only quote facts in the FACTS section.');
  must_not.push('Do not greet again if the conversation is already in progress.');
  must_do.push('Match the customer language exactly.');
  must_do.push('Keep replies under 3 short sentences unless the user asks for detail.');

  // Filter BMS facts by intent entities
  const facts: string[] = [];
  const qri: string = company.quick_reference_info || '';
  const bmsMatch = qri.match(/<!--\s*BMS_SYNC_START\s*-->([\s\S]*?)<!--\s*BMS_SYNC_END\s*-->/);
  const bmsBlock = bmsMatch ? bmsMatch[1] : '';

  // Hours / services as baseline facts
  if (company.hours) facts.push(`Hours: ${String(company.hours).slice(0, 200)}`);
  if (company.services) facts.push(`Services: ${String(company.services).slice(0, 300)}`);

  if (bmsBlock) {
    const lines = bmsBlock.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const entityValues = Object.values(intent.entities || {}).map(v => String(v).toLowerCase()).filter(Boolean);
    const askText = (intent.asks || []).join(' ').toLowerCase() + ' ' + intent.cleaned_text.toLowerCase();
    const isProductIntent = /price|cost|stock|buy|order|product|catalog|available|list|show/i.test(intent.intent_type + ' ' + askText);

    // Always include stock alerts
    const stockAlertIdx = lines.findIndex(l => /^##\s*Stock Alerts/i.test(l));
    if (stockAlertIdx >= 0) {
      for (let i = stockAlertIdx + 1; i < lines.length && i < stockAlertIdx + 8; i++) {
        if (lines[i].startsWith('##')) break;
        facts.push(lines[i]);
      }
    }

    // For product intents, pull matching product lines
    if (isProductIntent) {
      const matched = lines
        .filter(l => /^[-•*]/.test(l) || /\d/.test(l))
        .filter(l => {
          const ll = l.toLowerCase();
          return entityValues.some(v => v && ll.includes(v)) || /price|stock|kw|usd|zmw/i.test(l);
        })
        .slice(0, 10);
      facts.push(...matched);
    }
  }

  const rules: RuleSet = {
    must_do: dedupe(must_do).slice(0, 12),
    must_not: dedupe(must_not).slice(0, 12),
    brand_voice,
    facts: dedupe(facts).slice(0, 20),
    language: intent.language,
  };

  return { rules, ms: Date.now() - start, model: 'glm-4.7+local' };
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.toLowerCase().trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(s.trim());
    }
  }
  return out;
}
