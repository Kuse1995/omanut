import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const DEMO_BOSS_PHONE = '+260972064502';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { from, body, company_id, boss_phone, profile_name } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Clean expired sessions
    await supabase
      .from('demo_sessions')
      .delete()
      .eq('company_id', company_id)
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString());

    const senderPhone = from.replace('whatsapp:', '');
    const isBoss = senderPhone === DEMO_BOSS_PHONE;
    const messageText = (body || '').trim();
    const upperMessage = messageText.toUpperCase();

    console.log(`[DEMO] from=${senderPhone} isBoss=${isBoss} msg="${messageText.substring(0, 50)}"`);

    // ── Boss Commands ──
    if (isBoss) {
      const bossResult = await handleBossCommand(supabase, upperMessage, messageText, company_id);
      if (bossResult) return bossResult;
      // Boss sent something else — treat as regular customer for demo
    }

    // ── Customer Messages (or boss non-command messages) ──
    const { data: activeSession } = await supabase
      .from('demo_sessions')
      .select('*')
      .eq('company_id', company_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeSession) {
      return isBoss
        ? respond(`👋 *Boss Commands:*\n\n• DEMO [company name] — Start a demo\n  e.g. "DEMO Airtel Zambia"\n• ERASE — Clear active demo\n• ACT AS [persona] — Change AI style\n• STATUS — Check current demo`)
        : respond(`👋 Welcome to the Omanut AI demo!\n\nThis number showcases our AI receptionist technology.\n\nThe demo is not currently active. Please ask the business owner to set one up, or check back soon!`);
    }

    // Build AI prompt from researched data
    const rd = activeSession.researched_data as Record<string, string> || {};
    const persona = activeSession.custom_persona || rd.voice_style || 'Professional and helpful';
    const customerName = profile_name || 'Unknown';

    const systemPrompt = buildDemoSystemPrompt(activeSession.demo_company_name, rd, persona, customerName);

    // Get or create conversation
    const conversationId = await getOrCreateConversation(supabase, company_id, senderPhone, profile_name, activeSession.demo_company_name);

    // Save customer message
    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: messageText,
      });
    }

    // Get conversation history
    const conversationHistory = await getConversationHistory(supabase, conversationId);

    // Main AI response
    const aiResponse = await callAIWithHistory(conversationHistory, systemPrompt);
    if (!aiResponse) {
      return respond("I apologize, I'm experiencing a brief technical issue. Please try again in a moment!");
    }

    const responseText = typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse);

    // Save AI response
    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: responseText,
      });
      await supabase.from('conversations').update({
        last_message_preview: responseText.substring(0, 100),
      }).eq('id', conversationId);
    }

    // ── Intelligent Handoff Evaluation (runs after response, doesn't block customer) ──
    const fullHistory = [...conversationHistory, { role: 'assistant', content: responseText }];
    evaluateAndHandoff(fullHistory, activeSession, senderPhone, profile_name, company_id).catch(e =>
      console.error('[DEMO] Handoff evaluation error:', e)
    );

    return respond(responseText);
  } catch (error) {
    console.error('[DEMO] Error:', error);
    return respond('Sorry, something went wrong. Please try again.');
  }
});

// ─── Boss Command Handler ───
async function handleBossCommand(supabase: any, upperMessage: string, messageText: string, company_id: string): Promise<Response | null> {
  // DEMO [company name]
  const demoMatch = upperMessage.startsWith('DEMO ')
    ? messageText.substring(5).trim()
    : upperMessage.match(/^(?:SET|START|ACTIVATE|LAUNCH)\s+(?:THE\s+)?DEMO\s+(?:TO|FOR|AS)\s+(.+)/i)?.[1]?.trim();

  if (demoMatch !== undefined && demoMatch !== null) {
    const companyName = demoMatch;
    if (!companyName) return respond('Please provide a company name. Example: DEMO Hilton Lusaka');

    console.log(`[DEMO] Boss requested demo for: ${companyName}`);
    const researchData = await callAI(buildResearchPrompt(companyName), 'You are a business research assistant. Always return valid JSON only, no markdown formatting.');
    if (!researchData) return respond(`❌ Could not research "${companyName}". Please try again.`);

    // Close old conversations & sessions
    await supabase.from('conversations').update({ status: 'ended' }).eq('company_id', company_id).eq('active_agent', 'demo').eq('status', 'active');
    await supabase.from('demo_sessions').delete().eq('company_id', company_id).eq('status', 'active');

    const { error: insertError } = await supabase.from('demo_sessions').insert({
      company_id, demo_company_name: companyName, researched_data: researchData, status: 'active',
    });
    if (insertError) { console.error('[DEMO] Insert error:', insertError); return respond('❌ Failed to create demo session.'); }

    return respond(
      `✅ Demo activated for *${companyName}*!\n\n📊 Research confidence: ${researchData.confidence_score || 'N/A'}/100\n🏢 Type: ${researchData.business_type || 'Unknown'}\n🕐 Hours: ${researchData.hours || 'Not found'}\n\nAnyone texting this number will now interact with the AI as ${companyName}'s receptionist.\n\nCommands:\n• ERASE - Clear demo\n• ACT AS [persona] - Change AI style\n• STATUS - Check current demo\n• DEMO [name] - Switch company`
    );
  }

  // ERASE / RESET / CLEAR
  if (/\b(ERASE|RESET|CLEAR)\b/.test(upperMessage)) {
    await supabase.from('conversations').update({ status: 'ended' }).eq('company_id', company_id).eq('active_agent', 'demo').eq('status', 'active');
    const { data: deleted } = await supabase.from('demo_sessions').delete().eq('company_id', company_id).eq('status', 'active').select('demo_company_name');
    return respond(deleted?.length ? `🧹 Demo erased! ${deleted.length} session(s) cleared. Ready for next demo.` : `ℹ️ No active demo to erase.`);
  }

  // ACT AS [persona]
  if (upperMessage.startsWith('ACT AS ')) {
    const persona = messageText.substring(7).trim();
    if (!persona) return respond('Please provide a persona. Example: ACT AS friendly hotel concierge');
    const { data: updated } = await supabase.from('demo_sessions').update({ custom_persona: persona }).eq('company_id', company_id).eq('status', 'active').select('demo_company_name');
    return updated?.length ? respond(`🎭 Persona updated to: "${persona}" for ${updated[0].demo_company_name}`) : respond('⚠️ No active demo session. Start one first with: DEMO [company name]');
  }

  // STATUS
  if (upperMessage === 'STATUS' || upperMessage.includes('STATUS')) {
    const { data: sessions } = await supabase.from('demo_sessions').select('demo_company_name, custom_persona, created_at, expires_at').eq('company_id', company_id).eq('status', 'active');
    if (!sessions?.length) return respond('📊 No active demo session.\n\nStart one with: DEMO [company name]');
    const s = sessions[0];
    const expiresIn = Math.round((new Date(s.expires_at).getTime() - Date.now()) / 3600000);
    return respond(`📊 *Demo Status*\n\n🏢 Company: ${s.demo_company_name}\n🎭 Persona: ${s.custom_persona || 'Default (from research)'}\n⏰ Expires in: ~${expiresIn}h`);
  }

  return null; // Not a boss command
}

// ─── System Prompt Builder ───
function buildDemoSystemPrompt(companyName: string, rd: Record<string, string>, persona: string, customerName: string): string {
  return `You are demonstrating Omanut AI by acting as ${companyName}'s AI receptionist.

Business type: ${rd.business_type || 'General business'}
Services: ${rd.services || 'Various services'}
Hours: ${rd.hours || 'Standard business hours'}
Communication style: ${persona}
Key information: ${rd.quick_reference_info || 'A quality establishment'}
Branches: ${rd.branches || 'Main location'}
Service areas: ${rd.service_locations || 'Main area'}

FIRST CONTACT GREETING:
- The customer's WhatsApp name is: "${customerName}"
- On the very first message of the conversation, warmly greet them, mention you noticed their name is ${customerName}, and ask if that's what they prefer to be called — then naturally transition into how you can help them.
- If you've already greeted them (there are prior messages in the conversation), do NOT repeat the name confirmation. Just continue the conversation naturally.

IMPORTANT RULES:
- Stay in character as ${companyName}'s receptionist at all times.
- Be impressive and natural. Show the full range of AI capabilities.
- Handle bookings, pricing inquiries, FAQs, and recommendations naturally.
- If asked about Omanut AI itself, briefly explain it's an AI receptionist platform, then return to character.
- Keep responses concise but helpful (max 3-4 sentences unless detail is needed).
- Use the business information above to give realistic, specific answers.
- If you don't know something specific, give a plausible answer based on the business type.
- When a customer completes an order or booking, confirm the details back to them and let them know the team will follow up shortly.
- Do NOT include any special tags or markers in your response. Just respond naturally.`;
}

// ─── Intelligent Handoff Evaluation Agent ───
async function evaluateAndHandoff(
  conversationHistory: { role: string; content: string }[],
  session: any,
  senderPhone: string,
  profileName: string | null,
  companyId: string,
): Promise<void> {
  // Skip evaluation on short conversations (fewer than 4 messages = less than 2 full exchanges)
  const userMessages = conversationHistory.filter(m => m.role === 'user');
  if (userMessages.length < 3) {
    console.log(`[DEMO] Skipping handoff eval — only ${userMessages.length} user messages (need 3+)`);
    return;
  }

  const evaluationPrompt = `You are a handoff evaluation agent. Analyze this conversation between a customer and an AI receptionist for "${session.demo_company_name}" and determine if a handoff to a human is needed RIGHT NOW.

SOFT HANDOFF (return "soft_handoff") — AI handled it well, but a human needs to act on the outcome:
- Customer has COMPLETED placing an order: confirmed specific items, quantities, AND delivery/pickup details
- Customer has provided payment details or proof of payment
- Customer made a COMPLETE booking/reservation with ALL required details (date, time, guests, name)
- Customer explicitly filed a complaint demanding a refund, replacement, or escalation
- Customer completed a negotiation that requires human sign-off on final terms/pricing

HARD HANDOFF (return "hard_handoff") — Customer needs a human to take over NOW:
- Customer explicitly asks for a human, manager, or real person
- Customer expresses clear frustration or anger after 3+ exchanges on the same issue
- Legal, safety, or emergency situation mentioned
- AI has failed to resolve the same issue after 3+ back-and-forth messages

NO HANDOFF (return "none") — MOST conversations fall here:
- Customer asking how to do something (e.g., "how do I withdraw?", "what are your rates?")
- Customer asking about services, prices, hours, locations, policies
- General inquiries, FAQs, browsing menu/services
- Customer gathering information or deciding — even if asking many questions
- Customer asking "why" questions about policies or processes
- Customer expressing mild dissatisfaction that the AI is actively resolving
- AI explaining processes, providing instructions, or answering questions
- ANY informational question, even complex ones — the AI can handle these

CRITICAL RULES:
- DEFAULT TO "none". Only trigger handoff when there is a CLEAR, COMPLETED action milestone.
- Asking questions ≠ complaint. Asking "how do I withdraw money?" is an FAQ, NOT a handoff.
- An order is only complete when customer confirmed items AND delivery/contact details.
- A complaint only triggers handoff if the customer DEMANDS action (refund/replacement/escalation).
- When in doubt, return "none".

Return ONLY valid JSON:
{
  "decision": "none" | "soft_handoff" | "hard_handoff",
  "reason": "1-2 sentence explanation",
  "summary": "structured summary for the business owner (only if handoff)",
  "extracted_data": {
    "customer_name": "if known",
    "order_items": "list of items if applicable",
    "delivery_address": "if provided",
    "contact_info": "phone or email if shared",
    "booking_details": "date/time/guests if applicable",
    "total_estimate": "estimated cost if applicable",
    "complaint_details": "if complaint",
    "urgency": "low | medium | high"
  }
}`;

  const result = await callAI(
    `Conversation history:\n${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}`,
    evaluationPrompt,
  );

  if (!result || result.decision === 'none') {
    console.log('[DEMO] Handoff eval: none');
    return;
  }

  console.log(`[DEMO] Handoff eval: ${result.decision} — ${result.reason}`);

  const ed = result.extracted_data || {};
  const customerLabel = profileName || ed.customer_name || 'Unknown';

  let bossMessage: string;

  if (result.decision === 'soft_handoff') {
    // Build structured notification based on what data was extracted
    const sections: string[] = [];
    sections.push(`🔔 *[${getHandoffEmoji(ed)} ${getHandoffTitle(result, session)}]*\n`);
    sections.push(`👤 Customer: ${customerLabel} (${senderPhone})`);
    sections.push(`🏢 Demo: ${session.demo_company_name}\n`);

    if (ed.order_items) sections.push(`📋 *Order:*\n${ed.order_items}`);
    if (ed.booking_details) sections.push(`📅 *Booking:* ${ed.booking_details}`);
    if (ed.delivery_address) sections.push(`📍 *Delivery:* ${ed.delivery_address}`);
    if (ed.contact_info) sections.push(`📞 *Contact:* ${ed.contact_info}`);
    if (ed.total_estimate) sections.push(`💰 *Est. Total:* ${ed.total_estimate}`);
    if (ed.complaint_details) sections.push(`⚠️ *Issue:* ${ed.complaint_details}`);
    if (result.summary) sections.push(`\n📝 ${result.summary}`);
    sections.push(`\n🤖 AI handled the full conversation. Customer expects follow-up.`);

    bossMessage = sections.join('\n');
  } else {
    // Hard handoff — urgent
    bossMessage =
      `🚨 *[URGENT HANDOFF]*\n\n` +
      `👤 Customer: ${customerLabel} (${senderPhone})\n` +
      `🏢 Demo: ${session.demo_company_name}\n\n` +
      `⚠️ *Reason:* ${result.reason}\n` +
      (ed.complaint_details ? `💬 *Details:* ${ed.complaint_details}\n` : '') +
      (result.summary ? `\n📝 ${result.summary}\n` : '') +
      `\n🔴 Customer has been told someone will follow up. Please respond ASAP.`;
  }

  // Create support ticket and queue item for visibility on pitch page
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const customerLabel = profileName || ed.customer_name || 'Unknown';
  const priority = ed.urgency === 'high' ? 'high' : ed.urgency === 'medium' ? 'medium' : 'low';
  const issueCategory = ed.complaint_details ? 'complaint' : ed.order_items ? 'order' : ed.booking_details ? 'booking' : 'general';
  const department = issueCategory === 'complaint' ? 'Customer Service' : issueCategory === 'order' ? 'Sales' : issueCategory === 'booking' ? 'Reservations' : 'General';

  // Get conversation ID
  const { data: activeConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('company_id', companyId)
    .eq('phone', `whatsapp:${senderPhone}`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const conversationId = activeConv?.id || null;

  // Insert support ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('support_tickets')
    .insert({
      company_id: companyId,
      customer_name: customerLabel,
      customer_phone: senderPhone,
      issue_summary: result.summary || result.reason || 'Handoff from AI',
      issue_category: issueCategory,
      priority,
      status: 'open',
      recommended_department: department,
      conversation_id: conversationId,
    })
    .select('id')
    .single();

  if (ticketError) {
    console.error('[DEMO] Failed to create ticket:', ticketError);
  } else {
    console.log(`[DEMO] Created ticket ${ticket.id}`);

    // Insert agent queue item
    const slaDeadline = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: queueError } = await supabase
      .from('agent_queue')
      .insert({
        company_id: companyId,
        ticket_id: ticket.id,
        conversation_id: conversationId,
        customer_name: customerLabel,
        customer_phone: senderPhone,
        priority,
        status: 'waiting',
        department,
        ai_summary: result.summary || result.reason || 'Escalated from AI demo',
        sla_deadline: slaDeadline,
      });

    if (queueError) {
      console.error('[DEMO] Failed to create queue item:', queueError);
    } else {
      console.log(`[DEMO] Created queue item for ticket ${ticket.id}`);
    }
  }

  // Mark conversation as handed off
  if (conversationId) {
    await supabase.from('conversations').update({
      human_takeover: true,
      takeover_at: new Date().toISOString(),
    }).eq('id', conversationId);
  }

  try {
    await sendWhatsAppToBoss(bossMessage, companyId);
    console.log(`[DEMO] ${result.decision} notification sent to boss`);
  } catch (e) {
    console.error('[DEMO] Failed to send handoff notification:', e);
  }
}

function getHandoffEmoji(ed: any): string {
  if (ed.order_items) return '🛒';
  if (ed.booking_details) return '📅';
  if (ed.complaint_details) return '⚠️';
  return '📋';
}

function getHandoffTitle(result: any, session: any): string {
  const ed = result.extracted_data || {};
  if (ed.order_items) return 'ORDER RECEIVED';
  if (ed.booking_details) return 'BOOKING REQUEST';
  if (ed.complaint_details) return 'COMPLAINT';
  return 'ACTION NEEDED';
}

// ─── Conversation Management ───
async function getOrCreateConversation(supabase: any, companyId: string, senderPhone: string, profileName: string | null, demoCompanyName: string): Promise<string | null> {
  const { data: existingConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('company_id', companyId)
    .eq('phone', `whatsapp:${senderPhone}`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingConv) {
    if (profileName) {
      await supabase.from('conversations').update({ customer_name: profileName }).eq('id', existingConv.id);
    }
    return existingConv.id;
  }

  const { data: newConv } = await supabase
    .from('conversations')
    .insert({
      company_id: companyId,
      phone: `whatsapp:${senderPhone}`,
      status: 'active',
      customer_name: profileName || `Demo (${demoCompanyName})`,
      active_agent: 'demo',
    })
    .select('id')
    .single();

  return newConv?.id || null;
}

async function getConversationHistory(supabase: any, conversationId: string | null): Promise<{ role: string; content: string }[]> {
  if (!conversationId) return [];
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(20);

  return (history || []).map((m: any) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
}

// ─── WhatsApp / Twilio ───
async function sendWhatsAppToBoss(message: string, companyId: string): Promise<void> {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) { console.error('[DEMO] Missing Twilio credentials'); return; }

  const FROM_NUMBER = 'whatsapp:+13345083612';
  const TO_NUMBER = `whatsapp:${DEMO_BOSS_PHONE}`;
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const formData = new URLSearchParams();
  formData.append('From', FROM_NUMBER);
  formData.append('To', TO_NUMBER);
  formData.append('Body', message);

  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[DEMO] Boss notification failed:', response.status, err);
  } else {
    console.log('[DEMO] Boss notification sent via Twilio');
  }
}

// ─── AI Helpers ───
function respond(message: string) {
  return new Response(JSON.stringify({ reply: message }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildResearchPrompt(companyName: string): string {
  return `You are a business research assistant helping to set up an AI customer service system.

Company to research: "${companyName}"

Research this company and provide detailed, structured information. If you cannot find specific information about this exact company:
1. Identify the likely industry/business type from the company name
2. Research similar businesses in that industry  
3. Provide industry-standard configurations and best practices

Return ONLY valid JSON with this structure:
{
  "business_type": "string",
  "voice_style": "string describing communication tone",
  "hours": "operating hours string",
  "services": "comma-separated services",
  "branches": "branch names if multiple",
  "service_locations": "service areas within the business",
  "quick_reference_info": "2-3 sentences of key facts",
  "system_instructions": "2-3 sentences for AI behavior",
  "qa_style": "how to answer questions",
  "banned_topics": "topics to avoid",
  "confidence_score": 0-100,
  "research_summary": "1-2 sentences on data reliability"
}`;
}

async function callAI(userMessage: string, systemPrompt: string): Promise<any> {
  return callAIWithHistory([{ role: 'user', content: userMessage }], systemPrompt);
}

async function callAIWithHistory(messages: { role: string; content: string }[], systemPrompt: string): Promise<any> {
  try {
    // Use flash-lite for evaluation prompts (cheap/fast), flash for main responses
    const isEvaluation = systemPrompt.includes('handoff evaluation agent');
    const model = isEvaluation ? 'google/gemini-2.5-flash-lite' : 'google/gemini-3-flash-preview';

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        temperature: isEvaluation ? 0.3 : 0.7,
      }),
    });

    if (!response.ok) {
      console.error('[DEMO] AI API error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (systemPrompt.includes('Return ONLY valid JSON')) {
      let clean = content.trim();
      if (clean.startsWith('```json')) clean = clean.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      else if (clean.startsWith('```')) clean = clean.replace(/```\n?/g, '');
      try {
        return JSON.parse(clean);
      } catch {
        console.error('[DEMO] Failed to parse JSON:', clean.substring(0, 200));
        return null;
      }
    }

    return content;
  } catch (error) {
    console.error('[DEMO] AI call error:', error);
    return null;
  }
}
