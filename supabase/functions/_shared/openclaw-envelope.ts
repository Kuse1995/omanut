// Builds the OpenClaw event envelope from an inbound_events row + company.
// Same shape as the legacy openclaw-dispatch payload so OpenClaw doesn't need
// to relearn the contract — just a new transport (pull/SSE/Realtime).

export interface EnvelopeOptions {
  signSecret?: string | null;
}

export async function buildEnvelope(
  supabase: any,
  ev: any,
  opts: EnvelopeOptions = {},
): Promise<{ envelope: Record<string, unknown>; signature: string | null }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const replyToUrl = `${supabaseUrl}/functions/v1/openclaw-reply`;
  const lookupUrl = `${supabaseUrl}/functions/v1/openclaw-lookup`;

  // 1) Company context
  const { data: company } = await supabase
    .from('companies')
    .select(
      'id, name, business_type, voice_style, metadata, currency_prefix, payments_disabled, ' +
        'quick_reference_info, services, service_locations, hours, branches, ' +
        'payment_instructions, payment_number_airtel, payment_number_mtn, payment_number_zamtel',
    )
    .eq('id', ev.company_id)
    .maybeSingle();

  const c = company ?? { id: ev.company_id, name: 'Unknown' };

  // 2) Recent history (channel-aware budget: WhatsApp/DM 6 msgs, comments 2)
  const limit = ev.channel === 'public_comment' ? 2 : 6;
  let history: Array<{ role: string; content: string; at: string }> = [];
  if (ev.conversation_id) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', ev.conversation_id)
      .order('created_at', { ascending: false })
      .limit(limit);
    history = (msgs ?? []).reverse().map((m: any) => ({
      role: m.role,
      content: (m.content ?? '').slice(0, 1000),
      at: m.created_at,
    }));
  }

  // 3) BMS snapshot (cached only — pull endpoint must stay fast)
  let bmsSnapshot: { text: string; synced_at: string | null } | null = null;
  try {
    const { data: bmsRow } = await supabase
      .from('bms_connections')
      .select('last_kb_text, last_bms_sync_at, is_active')
      .eq('company_id', c.id)
      .eq('is_active', true)
      .maybeSingle();
    if (bmsRow?.last_kb_text) {
      bmsSnapshot = {
        text: bmsRow.last_kb_text.slice(0, 8000),
        synced_at: bmsRow.last_bms_sync_at,
      };
    }
  } catch { /* best effort */ }

  // 4) Inbound media (Twilio auth-inlined, Meta URLs pass through)
  const p: any = ev.payload ?? {};
  const collected: string[] = [];
  const pushUrl = (u: any) => { if (typeof u === 'string' && u.startsWith('http')) collected.push(u); };
  if (Array.isArray(p.media_urls)) p.media_urls.forEach(pushUrl);
  if (Array.isArray(p.mediaUrls)) p.mediaUrls.forEach(pushUrl);
  for (let i = 0; i < 10; i++) pushUrl(p[`MediaUrl${i}`]);

  const twSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const twTok = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const inboundMediaUrls = collected.map((url) => {
    if (twSid && twTok && url.includes('api.twilio.com') && !url.includes('@')) {
      return url.replace('https://', `https://${twSid}:${twTok}@`);
    }
    return url;
  });

  const inboundText: string = p.text || p.message || '';
  const kbSummary = typeof (c as any).quick_reference_info === 'string'
    ? (c as any).quick_reference_info.slice(0, 600)
    : null;

  const companyContext = {
    name: c.name,
    business_type: (c as any).business_type ?? null,
    sales_mode: (c as any).metadata?.sales_mode ?? null,
    voice_style: (c as any).voice_style ?? null,
    currency_prefix: (c as any).currency_prefix ?? null,
    services: (c as any).services ?? null,
    service_locations: (c as any).service_locations ?? null,
    hours: (c as any).hours ?? null,
    branches: (c as any).branches ?? null,
    payment_instructions: (c as any).payment_instructions ?? null,
    payment_numbers: {
      airtel: (c as any).payment_number_airtel ?? null,
      mtn: (c as any).payment_number_mtn ?? null,
      zamtel: (c as any).payment_number_zamtel ?? null,
    },
    payments_disabled: !!(c as any).payments_disabled,
    knowledge_base: typeof (c as any).quick_reference_info === 'string'
      ? (c as any).quick_reference_info.slice(0, 12000)
      : null,
    knowledge_base_truncated:
      typeof (c as any).quick_reference_info === 'string' &&
      (c as any).quick_reference_info.length > 12000,
  };

  const envelope: Record<string, unknown> = {
    event_id: ev.id,
    company_id: c.id,
    company_name: c.name,
    company_brief: {
      business_type: (c as any).business_type ?? null,
      sales_mode: (c as any).metadata?.sales_mode ?? null,
      voice_style: (c as any).voice_style ?? null,
      currency_prefix: (c as any).currency_prefix ?? null,
      payments_disabled: !!(c as any).payments_disabled,
    },
    company_context: companyContext,
    bms_snapshot: bmsSnapshot,
    kb_summary: kbSummary,
    kb_available: !!kbSummary,
    bms_available: !!bmsSnapshot?.text,
    channel: ev.channel,
    source: ev.source,
    conversation_id: ev.conversation_id ?? null,
    drafter_mode: true,
    reply_to_url: replyToUrl,
    lookup_url: lookupUrl,
    lookup_intents: ['search_kb', 'check_stock', 'list_products', 'get_pricing', 'low_stock_alerts', 'get_sales_summary'],
    reply_instructions: [
      `You ARE the official ${c.name} agent. Reply in the company voice_style.`,
      `TOOL-FIRST: For any factual answer (fees, prices, hours, payment numbers, policies, services, contact info, products, stock), call MCP tools first OR POST to lookup_url with { company_id, intent, query } + X-Openclaw-Signature: sha256=<HMAC-SHA256(body, OPENCLAW_WEBHOOK_SECRET)>.`,
      `When ready, POST { event_id, reply_text, action: "send" } to reply_to_url with the same signature. Do NOT send via Twilio/Meta yourself.`,
      `Use action: "handoff" ONLY if the data is genuinely missing. Keep replies 1-3 sentences for simple questions.`,
    ].join(' '),
    process_now: true,
    customer_phone: p.customer_phone ?? p.From ?? null,
    customer_name: p.customer_name ?? p.ProfileName ?? null,
    inbound_text: inboundText,
    inbound: {
      text: inboundText,
      media_urls: inboundMediaUrls,
      media_count: inboundMediaUrls.length,
    },
    recent_history: history,
    payload: p,
    enqueued_at: ev.created_at,
    dispatched_at: new Date().toISOString(),
  };

  let signature: string | null = null;
  if (opts.signSecret) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(opts.signSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign'],
    );
    const buf = await crypto.subtle.sign('HMAC', key, enc.encode(JSON.stringify(envelope)));
    signature = 'sha256=' + Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  return { envelope, signature };
}
