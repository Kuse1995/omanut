import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get company_id from request body
    const { company_id } = await req.json();
    
    if (!company_id) {
      throw new Error('company_id is required');
    }

    // Get company data for the specific company
    const { data: company } = await supabase
      .from('companies')
      .select('*, metadata')
      .eq('id', company_id)
      .single();

    // Check credit balance FIRST
    if (company.credit_balance <= 0) {
      return new Response(JSON.stringify({ 
        error: 'Service paused. Please top up credits.' 
      }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch AI overrides for this company
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company.id)
      .single();

    // Industry-specific configurations
    const industryPrompts: Record<string, { location_prompt: string; confirmation: string }> = {
      restaurant: {
        location_prompt: "Which area would you prefer - poolside, outdoor terrace, or indoor dining?",
        confirmation: "booking for {guests} guests on {date} at {time} in the {location} area"
      },
      clinic: {
        location_prompt: "Which department do you need - general consultation, pediatrics, or specialist?",
        confirmation: "appointment on {date} at {time} in the {location} department"
      },
      gym: {
        location_prompt: "Which area would you like to use - main gym floor, yoga studio, or outdoor training area?",
        confirmation: "session on {date} at {time} in the {location}"
      },
      salon: {
        location_prompt: "Would you prefer the main salon area or our private VIP room?",
        confirmation: "appointment for your service on {date} at {time}"
      },
      hotel: {
        location_prompt: "Which facility would you like to book - restaurant, spa, or conference room?",
        confirmation: "reservation on {date} at {time} at our {location}"
      },
      spa: {
        location_prompt: "Would you like a regular treatment room or our VIP suite?",
        confirmation: "appointment for your service on {date} at {time}"
      }
    };

    const businessPrompt = industryPrompts[company.business_type] || {
      location_prompt: "Which location would you prefer?",
      confirmation: "appointment on {date} at {time}"
    };

    // Build comprehensive instructions with dynamic metadata
    let dynamicInfo = '';
    if (company.metadata && Object.keys(company.metadata).length > 0) {
      dynamicInfo = `\n\nREAL-TIME INFORMATION (Use this current data when answering):\n${JSON.stringify(company.metadata, null, 2)}`;
    }

    // Add quick reference info if available
    let quickRefInfo = '';
    if (company.quick_reference_info && company.quick_reference_info.trim()) {
      quickRefInfo = `\n\nKNOWLEDGE BASE (Important information about our business):\n${company.quick_reference_info}`;
    }

    let instructions = `You are the receptionist for ${company.name} in Zambia.
Business type: ${company.business_type}.
Voice style: ${company.voice_style}.
Business hours: ${company.hours}.
Locations / branches: ${company.branches}.
Services offered: ${company.services}.
Service locations available: ${company.service_locations}.
Currency: always use ${company.currency_prefix} (Kwacha).
Your job is to answer calls, help politely, and create/record bookings or appointments.
${dynamicInfo}
${quickRefInfo}

${aiOverrides?.system_instructions || ''}

Answer style:
${aiOverrides?.qa_style || ''}

Do NOT talk about:
${aiOverrides?.banned_topics || ''}

Critical rules:

1. LISTEN CAREFULLY: Always capture the EXACT information the customer provides. Never use placeholder values or make assumptions.

2. Always ask for the caller's phone number FIRST and repeat it back in pairs, like '0977 12 34 56, correct?'.

3. ASK FOR REQUIRED DETAILS: If the customer doesn't mention which branch or location, ASK them specifically:
   - "Which of our branches would you like to book at?"
   - "${businessPrompt.location_prompt}"

4. Before you create any reservation or appointment, ALWAYS repeat back ALL details and ask for confirmation using this format:
   'Just to confirm: You are [EXACT NAME GIVEN], phone number [EXACT PHONE GIVEN], ${businessPrompt.confirmation.replace('{guests}', '[EXACT NUMBER]').replace('{date}', '[DATE]').replace('{time}', '[TIME]').replace('{location}', '[EXACT LOCATION]')}, correct?'
   Only call create_reservation after they clearly confirm yes.

5. If the line is noisy or unclear: say 'I'm sorry, the line is not clear. Can you please repeat that slowly for me?'
   If still unclear after 2 tries: say 'I'll ask a human to call you back to confirm. Thank you.' and DO NOT guess details.

6. NEVER invent, assume, or use default values. If unsure, ask.

7. Always speak in warm, respectful Zambian English (not American call center style).

8. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.`;

    // Request an ephemeral token from OpenAI
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "alloy",
        instructions
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    console.log("Ephemeral session created");

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});