import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { from, body, company_id, boss_phone } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Clean expired sessions
    await supabase
      .from('demo_sessions')
      .delete()
      .eq('company_id', company_id)
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString());

    const senderPhone = from.replace('whatsapp:', '');
    const bossPhone = boss_phone?.replace('whatsapp:', '');
    const isBoss = bossPhone && senderPhone === bossPhone;
    const messageText = (body || '').trim();
    const upperMessage = messageText.toUpperCase();

    console.log(`[DEMO] from=${senderPhone} isBoss=${isBoss} msg="${messageText.substring(0, 50)}"`);

    // ── Boss Commands ──
    if (isBoss) {
      // DEMO [company name]
      if (upperMessage.startsWith('DEMO ')) {
        const companyName = messageText.substring(5).trim();
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

      // ERASE / RESET / CLEAR
      if (['ERASE', 'RESET', 'CLEAR'].includes(upperMessage)) {
        const { data: deleted } = await supabase
          .from('demo_sessions')
          .delete()
          .eq('company_id', company_id)
          .eq('status', 'active')
          .select('demo_company_name');

        const count = deleted?.length || 0;
        return respond(
          count > 0
            ? `🧹 Demo erased! ${count} session(s) cleared. Ready for next demo.`
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
      if (upperMessage === 'STATUS') {
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
      return respond(
        `👋 Welcome to the Omanut AI demo!\n\n` +
        `This number showcases our AI receptionist technology.\n\n` +
        `The demo is not currently active. Please ask the business owner to set one up, or check back soon!`
      );
    }

    // Build AI prompt from researched data
    const rd = activeSession.researched_data as Record<string, string> || {};
    const persona = activeSession.custom_persona || rd.voice_style || 'Professional and helpful';

    const systemPrompt = `You are demonstrating Omanut AI by acting as ${activeSession.demo_company_name}'s AI receptionist.

Business type: ${rd.business_type || 'General business'}
Services: ${rd.services || 'Various services'}
Hours: ${rd.hours || 'Standard business hours'}
Communication style: ${persona}
Key information: ${rd.quick_reference_info || 'A quality establishment'}
Branches: ${rd.branches || 'Main location'}
Service areas: ${rd.service_locations || 'Main area'}

IMPORTANT RULES:
- Stay in character as ${activeSession.demo_company_name}'s receptionist at all times.
- Be impressive and natural. Show the full range of AI capabilities.
- Handle bookings, pricing inquiries, FAQs, and recommendations naturally.
- If asked about Omanut AI itself, briefly explain it's an AI receptionist platform, then return to character.
- Keep responses concise but helpful (max 3-4 sentences unless detail is needed).
- Use the business information above to give realistic, specific answers.
- If you don't know something specific, give a plausible answer based on the business type.`;

    // Get conversation history for this phone in demo context
    const aiResponse = await callAI(messageText, systemPrompt);

    if (!aiResponse) {
      return respond("I apologize, I'm experiencing a brief technical issue. Please try again in a moment!");
    }

    // aiResponse is a string here since we use a different path
    return respond(typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse));

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

async function callAI(userMessage: string, systemPrompt: string): Promise<any> {
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
          { role: 'user', content: userMessage },
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

    // If system prompt asks for JSON (research), parse it
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
