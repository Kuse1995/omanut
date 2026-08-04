// Librarian v2: pulls company-scoped rules, facts, escalation triggers, payment methods,
// authorized handoff phone, plans and KB highlights. Reads company_ai_overrides +
// companies.quick_reference_info (incl. BMS block) directly. No model calls.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { IntentObject, RuleSet, SwarmInput } from './types.ts';

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.toLowerCase().trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(s.trim()); }
  }
  return out;
}

/** Extract a labelled block (e.g. "PLANS & PRICING:") from quick reference text. */
function extractBlock(text: string, label: string): string[] {
  const idx = text.indexOf(label);
  if (idx === -1) return [];
  const rest = text.slice(idx + label.length);
  const lines: string[] = [];
  for (const line of rest.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^[A-Z][A-Z &]+:$/.test(t) && t !== label.trim()) break; // next labelled block
    lines.push(t.replace(/^[-?*]\s*/, ''));
    if (lines.length >= 12) break;
  }
  return lines;
}

export async function runLibrarian(
  supabase: ReturnType<typeof createClient>,
  input: SwarmInput,
  intent: IntentObject,
): Promise<{ rules: RuleSet; ms: number; model: string }> {
  const start = Date.now();

  const [companyRes, aiRes] = await Promise.all([
    supabase
      .from('companies')
      .select('name, business_type, services, hours, quick_reference_info, twilio_number, whatsapp_number')
      .eq('id', input.company_id)
      .maybeSingle(),
    supabase
      .from('company_ai_overrides')
      .select('system_instructions, banned_topics, qa_style, fallback_message, auto_handoff_triggers')
      .eq('company_id', input.company_id)
      .maybeSingle(),
  ]);

  const company: any = companyRes.data || {};
  const ai: any = aiRes.data || {};

  const must_do: string[] = [];
  const must_not: string[] = [];

  const brand_voice = (ai.qa_style || 'Professional, warm, concise. First-person plural ("we").').toString();

  if (ai.banned_topics) {
    String(ai.banned_topics)
      .split(/[\n,;]+/)
      .map((s: string) => s.trim())
      .filter(Boolean)
      .forEach((t: string) => must_not.push('Do not discuss: ' + t));
  }

  if (ai.system_instructions) {
    String(ai.system_instructions)
      .split(/\n+/)
      .map((s: string) => s.trim().replace(/^[-?*]\s*/, ''))
      .filter((s: string) => s.length > 4)
      .slice(0, 14)
      .forEach((s: string) => must_do.push(s));
  }

  // Hard universal rules (learned from the 12-day canned-reply incident)
  must_not.push('Do not invent prices, stock, or contact details - only quote FACTS provided here.');
  must_not.push('Do not greet again if the conversation is already in progress.');
  must_not.push('Do not send a reply that repeats the previous assistant message.');
  must_not.push('Do not promise a payment link unless you can actually provide one from FACTS.');
  must_not.push('Do not output internal tags, tool calls, or control strings (e.g. <ctrl...>).');
  must_do.push('Match the customer language exactly.');
  must_do.push('Keep replies short and direct (1-3 sentences) unless the user asks for detail.');
  must_do.push('If a fact is missing, say we will check and follow up - never guess.');

  // KB escalation triggers
  const qri: string = company.quick_reference_info || '';
  const escalation_triggers: string[] = [];
  const escBlock = extractBlock(qri, 'ESCALATION TRIGGERS');
  if (escBlock.length) escalation_triggers.push(...escBlock);
  const autoTriggers = ai.auto_handoff_triggers;
  if (Array.isArray(autoTriggers) && autoTriggers.length) escalation_triggers.push('Auto handoff on: ' + autoTriggers.join(', '));
  if (!escalation_triggers.length) {
    escalation_triggers.push('5+ messages without progress', 'Customer asks for a human', 'Complaint or negative experience', 'Ready to buy / needs payment details', 'Customer frustration or repeated questions');
  }

  const payment_methods = extractBlock(qri, 'PAYMENT METHODS').filter((l) => !/specific payment numbers/i.test(l));
  const plans = extractBlock(qri, 'PLANS & PRICING');
  const services = company.services ? String(company.services).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8) : [];
  if (!plans.length) plans.push(...services);

  // Authorized handoff phone: twilio_number is the boss-facing handoff number in this system
  const authorized_phone = company.twilio_number || company.whatsapp_number || null;

  // Pay URL: look for a checkout/pay URL in quick reference or services
  const payUrlMatch = (qri + ' ' + String(company.services || '')).match(/https?:\/\/[^\s"']+/g) || [];
  const pay_url = payUrlMatch.find((u: string) => /pay|checkout|subscribe/i.test(u)) || null;

  const facts: string[] = [];
  if (company.hours) facts.push('Hours: ' + String(company.hours).slice(0, 200));
  if (company.business_type) facts.push('Business: ' + String(company.business_type).slice(0, 160));
  if (company.name) facts.push('Company name: ' + String(company.name).slice(0, 80));
  if (authorized_phone) facts.push('Handoff phone: ' + authorized_phone);
  if (pay_url) facts.push('Payment link: ' + pay_url);
  if (payment_methods.length) facts.push('Payment methods: ' + payment_methods.join(', '));
  facts.push(...plans);

  // BMS block: filter product/stock lines relevant to the intent
  const bmsMatch = qri.match(/<!--\s*BMS_SYNC_START\s*-->([\s\S]*?)<!--\s*BMS_SYNC_END\s*-->/);
  const bmsBlock = bmsMatch ? bmsMatch[1] : '';
  if (bmsBlock) {
    const lines = bmsBlock.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const entityValues = Object.values(intent.entities || {}).map((v) => String(v).toLowerCase()).filter(Boolean);
    const askText = (intent.asks || []).join(' ') + ' ' + intent.cleaned_text;
    const isProductIntent = /price|cost|stock|buy|order|product|catalog|available|list|show|invoice|receipt/i.test(intent.intent_type + ' ' + askText);

    const stockAlertIdx = lines.findIndex((l) => /^##\s*Stock Alerts/i.test(l));
    if (stockAlertIdx >= 0) {
      for (let i = stockAlertIdx + 1; i < lines.length && i < stockAlertIdx + 8; i++) {
        if (lines[i].startsWith('##')) break;
        facts.push(lines[i]);
      }
    }
    if (isProductIntent) {
      const matched = lines
        .filter((l) => /^[-?*]/.test(l) || /\d/.test(l))
        .filter((l) => {
          const ll = l.toLowerCase();
          return entityValues.some((v) => v && ll.includes(v)) || /price|stock|kw|usd|zmw/i.test(l);
        })
        .slice(0, 10);
      facts.push(...matched);
    }
  }

  const askText = (intent.asks || []).join(' ').toLowerCase() + ' ' + intent.cleaned_text.toLowerCase();
  const isProductIntent = /price|cost|stock|buy|order|product|catalog|available|list|show/i.test(intent.intent_type + ' ' + askText);
  const entityValues = Object.values(intent.entities || {}).map((v) => String(v).toLowerCase()).filter(Boolean);
  const hasMatchingFact = entityValues.length === 0 ? facts.length > 0 : facts.some((f) => entityValues.some((v) => v && f.toLowerCase().includes(v)));
  const bms_cache_hit = isProductIntent ? hasMatchingFact : true;
  const bms_miss = isProductIntent && !hasMatchingFact;

  if (bms_miss) {
    must_do.push('The specific product/price the customer asked about is NOT in FACTS. Tell them we will check our live system and follow up - do NOT invent prices or stock.');
  }

  const rules: RuleSet = {
    must_do: dedupe(must_do).slice(0, 14),
    must_not: dedupe(must_not).slice(0, 14),
    brand_voice,
    facts: dedupe(facts).slice(0, 24),
    language: intent.language,
    bms_cache_hit,
    bms_miss,
    escalation_triggers: dedupe(escalation_triggers).slice(0, 8),
    payment_methods: dedupe(payment_methods).slice(0, 4),
    authorized_phone,
    pay_url,
    plans: dedupe(plans).slice(0, 6),
  };

  return { rules, ms: Date.now() - start, model: 'local' };
}
