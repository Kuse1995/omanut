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
      // DEMO [company name] — also accept natural language like "set the demo to X"
      const demoMatch = upperMessage.startsWith('DEMO ')
        ? messageText.substring(5).trim()
        : upperMessage.match(/^(?:SET|START|ACTIVATE|LAUNCH)\s+(?:THE\s+)?DEMO\s+(?:TO|FOR|AS)\s+(.+)/i)?.[1]?.trim();

      if (demoMatch !== undefined && demoMatch !== null) {
        const companyName = demoMatch;
        if (!companyName) {
          return respond('Please provide a company name. Example: DEMO Hilton Lusaka');
        }

        console.log(`[DEMO] Boss requested demo for: ${companyName}`);

        // Research the company using inline AI call (same logic as research-company)
        const researchPrompt = buildResearchPrompt(companyName);
        const researchData = await callAI(researchPrompt, 'You are a business research assistant. Always return valid JSON only, no markdown formatting.');

        if (!researchData) {
          return respond(`❌ Could not research "${companyName}". Please try again.`);
        }

        // Close all existing demo conversations so old history isn't reused
        await supabase
          .from('conversations')
          .update({ status: 'ended' })
          .eq('company_id', company_id)
          .eq('active_agent', 'demo')
          .eq('status', 'active');

        // Delete any existing active sessions for this company
        await supabase
          .from('demo_sessions')
          .delete()
          .eq('company_id', company_id)
          .eq('status', 'active');

        // Create new demo session
        const { error: insertError } = await supabase
          .from('demo_sessions')
          .insert({
            company_id,
            demo_company_name: companyName,
            researched_data: researchData,
            status: 'active',
          });

        if (insertError) {
          console.error('[DEMO] Insert error:', insertError);
          return respond('❌ Failed to create demo session. Please try again.');
        }

        const confidence = researchData.confidence_score || 'N/A';
        return respond(
          `✅ Demo activated for *${companyName}*!\n\n` +
          `📊 Research confidence: ${confidence}/100\n` +
          `🏢 Type: ${researchData.business_type || 'Unknown'}\n` +
          `🕐 Hours: ${researchData.hours || 'Not found'}\n\n` +
          `Anyone texting this number will now interact with the AI as ${companyName}'s receptionist.\n\n` +
          `Commands:\n` +
          `• ERASE - Clear demo\n` +
          `• ACT AS [persona] - Change AI style\n` +
          `• STATUS - Check current demo\n` +
          `• DEMO [name] - Switch company`
        );
      }

      // ERASE / RESET / CLEAR (flexible matching)
      if (/\b(ERASE|RESET|CLEAR)\b/.test(upperMessage)) {
        // Close all demo conversations so old history isn't reused
        await supabase
          .from('conversations')
          .update({ status: 'ended' })
          .eq('company_id', company_id)
          .eq('active_agent', 'demo')
          .eq('status', 'active');

        const { data: deleted } = await supabase
          .from('demo_sessions')
          .delete()
          .eq('company_id', company_id)
          .eq('status', 'active')
          .select('demo_company_name');

        const count = deleted?.length || 0;
        return respond(
          count > 0
            ? `🧹 Demo erased! ${count} session(s) cleared and conversations reset. Ready for next demo.`
            : `ℹ️ No active demo to erase.`
        );
      }

      // ACT AS [persona]
      if (upperMessage.startsWith('ACT AS ')) {
        const persona = messageText.substring(7).trim();
        if (!persona) {
          return respond('Please provide a persona. Example: ACT AS friendly hotel concierge');
        }

        const { data: updated } = await supabase
          .from('demo_sessions')
          .update({ custom_persona: persona })
          .eq('company_id', company_id)
          .eq('status', 'active')
          .select('demo_company_name');

        if (!updated?.length) {
          return respond('⚠️ No active demo session. Start one first with: DEMO [company name]');
        }

        return respond(`🎭 Persona updated to: "${persona}" for ${updated[0].demo_company_name}`);
      }

      // STATUS
      if (upperMessage === 'STATUS' || upperMessage === 'STATUS?' || upperMessage.includes('STATUS')) {
        const { data: sessions } = await supabase
          .from('demo_sessions')
          .select('demo_company_name, custom_persona, created_at, expires_at')
          .eq('company_id', company_id)
          .eq('status', 'active');

        if (!sessions?.length) {
          return respond('📊 No active demo session.\n\nStart one with: DEMO [company name]');
        }

        const s = sessions[0];
        const expiresIn = Math.round((new Date(s.expires_at).getTime() - Date.now()) / 3600000);
        return respond(
          `📊 *Demo Status*\n\n` +
          `🏢 Company: ${s.demo_company_name}\n` +
          `🎭 Persona: ${s.custom_persona || 'Default (from research)'}\n` +
          `⏰ Expires in: ~${expiresIn}h\n` +
          `📱 Active sessions: ${sessions.length}`
        );
      }

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
      if (isBoss) {
        return respond(
          `👋 *Boss Commands:*\n\n` +
          `• DEMO [company name] — Start a demo\n` +
          `  e.g. "DEMO Airtel Zambia" or "Set the demo to Airtel Zambia"\n` +
          `• ERASE — Clear active demo\n` +
          `• ACT AS [persona] — Change AI style\n` +
          `• STATUS — Check current demo`
        );
      }
      return respond(
        `👋 Welcome to the Omanut AI demo!\n\n` +
        `This number showcases our AI receptionist technology.\n\n` +
        `The demo is not currently active. Please ask the business owner to set one up, or check back soon!`
      );
    }

    // Build AI prompt from researched data
    const rd = activeSession.researched_data as Record<string, string> || {};
    const persona = activeSession.custom_persona || rd.voice_style || 'Professional and helpful';

    const customerName = profile_name || 'Unknown';

    const systemPrompt = `You are demonstrating Omanut AI by acting as ${activeSession.demo_company_name}'s AI receptionist.

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
- Stay in character as ${activeSession.demo_company_name}'s receptionist at all times.
- Be impressive and natural. Show the full range of AI capabilities.
- Handle bookings, pricing inquiries, FAQs, and recommendations naturally.
- If asked about Omanut AI itself, briefly explain it's an AI receptionist platform, then return to character.
- Keep responses concise but helpful (max 3-4 sentences unless detail is needed).
- Use the business information above to give realistic, specific answers.
- If you don't know something specific, give a plausible answer based on the business type.
- If the customer explicitly asks to speak to a human, a manager, or has a complex issue you absolutely cannot resolve, include [HANDOFF_REQUIRED] at the very end of your response. Only use this when truly necessary.`;

    // Get or create conversation for this phone in demo context
    let conversationId: string;
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('company_id', company_id)
      .eq('phone', `whatsapp:${senderPhone}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
      // Backfill customer name if we now have it
      if (profile_name) {
        await supabase.from('conversations').update({ customer_name: profile_name }).eq('id', conversationId);
      }
    } else {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({
          company_id,
          phone: `whatsapp:${senderPhone}`,
          status: 'active',
          customer_name: profile_name || `Demo (${activeSession.demo_company_name})`,
          active_agent: 'demo',
        })
        .select('id')
        .single();
      conversationId = newConv?.id;
    }

    // Save customer message
    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: messageText,
      });
    }

    // Get conversation history for context
    let conversationHistory: { role: string; content: string }[] = [];
    if (conversationId) {
      const { data: history } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(20);
      if (history) {
        conversationHistory = history.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        }));
      }
    }

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
        content: responseText.replace('[HANDOFF_REQUIRED]', '').trim(),
      });
      // Update conversation preview
      await supabase.from('conversations').update({
        last_message_preview: responseText.substring(0, 100),
      }).eq('id', conversationId);
    }

    // Check for handoff signal
    if (responseText.includes('[HANDOFF_REQUIRED]')) {
      const cleanResponse = responseText.replace('[HANDOFF_REQUIRED]', '').trim();

      const handoffMessage =
        `🔔 *[DEMO HANDOFF]*\n\n` +
        `👤 Customer: ${profile_name || 'Unknown'} (${senderPhone})\n` +
        `🏢 Demo company: ${activeSession.demo_company_name}\n` +
        `💬 Customer said: "${messageText.substring(0, 200)}"\n\n` +
        `📋 Summary: Customer has been chatting with the AI receptionist for ${activeSession.demo_company_name} and is requesting to speak with a human representative.\n\n` +
        `🤖 Last AI response: "${cleanResponse.substring(0, 200)}"`;

      try {
        await sendWhatsAppToBoss(handoffMessage, company_id);
      } catch (e) {
        console.error('[DEMO] Failed to send handoff notification:', e);
      }

      return respond("I understand you'd like to speak with a real person. I'm connecting you now — someone will be in touch with you shortly! 🙏");
    }

    return respond(responseText);
  } catch (error) {
    console.error('[DEMO] Error:', error);
    return respond('Sorry, something went wrong. Please try again.');
  }
});

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

async function sendWhatsAppToBoss(message: string, companyId: string): Promise<void> {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('[DEMO] Missing Twilio credentials for boss notification');
    return;
  }

  // The demo line's Twilio WhatsApp number
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
    console.log('[DEMO] Boss handoff notification sent successfully via Twilio');
  }
}

async function callAI(userMessage: string, systemPrompt: string): Promise<any> {
  return callAIWithHistory([{ role: 'user', content: userMessage }], systemPrompt);
}

async function callAIWithHistory(messages: { role: string; content: string }[], systemPrompt: string): Promise<any> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        temperature: 0.7,
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
        console.error('[DEMO] Failed to parse research JSON');
        return null;
      }
    }

    return content;
  } catch (error) {
    console.error('[DEMO] AI call error:', error);
    return null;
  }
}
