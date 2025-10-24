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

    // For web demo, use first company (in production, get from user session)
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .limit(1)
      .single();

    // Fetch AI overrides for this company
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company?.id)
      .single();

    let instructions = company
      ? `You are the receptionist for ${company.name} in Zambia. Business type: ${company.business_type}. ${company.voice_style} Hours: ${company.hours}. Offerings: ${company.menu_or_offerings}. Branches: ${company.branches}. Seating areas: ${company.seating_areas}. Use ${company.currency_prefix} for prices. Say prices like '${company.currency_prefix}180', never in dollars.

CRITICAL ACCURACY RULES:
1. ALWAYS ask for the caller's phone number FIRST. Then repeat it back in pairs, e.g. "0977 12 34 56, correct?" Wait for confirmation.
2. BEFORE calling create_reservation, you MUST confirm ALL details: "Just to confirm: You are [NAME], phone number [PHONE], booking for [GUESTS] people on [DATE] at [TIME] in [AREA/BRANCH], correct?" Only proceed after they say "yes".
3. If the line is noisy or unclear, NEVER guess. Say: "I'm sorry, the line is not clear. Can you please repeat that slowly for me?" After 2 failed attempts, say: "I'll ask a human to call you back to confirm. Thank you." and end the booking attempt.
4. NEVER invent details. If you don't know something, ask the caller.
5. If they don't have email, say 'No problem, we can still keep your booking.'
6. Be friendly, warm, and local — not American call center tone.`
      : 'You are a helpful receptionist at a Zambian business. Always collect phone number first and use Kwacha for prices.';
    
    // Append AI overrides if they exist
    if (aiOverrides) {
      if (aiOverrides.system_instructions) {
        instructions += `\n\nADDITIONAL INSTRUCTIONS: ${aiOverrides.system_instructions}`;
      }
      if (aiOverrides.qa_style) {
        instructions += `\n\nQA STYLE: ${aiOverrides.qa_style}`;
      }
      if (aiOverrides.banned_topics) {
        instructions += `\n\nBANNED TOPICS: ${aiOverrides.banned_topics}`;
      }
    }

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