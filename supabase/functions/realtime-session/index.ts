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

    const instructions = company
      ? `You are the receptionist for ${company.name} in Zambia. Business type: ${company.business_type}. ${company.voice_style} Hours: ${company.hours}. Offerings: ${company.menu_or_offerings}. Branches: ${company.branches}. Seating areas: ${company.seating_areas}. Use ${company.currency_prefix} for prices. Say prices like '${company.currency_prefix}180', never in dollars. Always ask for the caller's phone number first so we can call or WhatsApp them back. If they don't have email, say 'No problem, we can still keep your booking.' If network is noisy or it cuts, politely ask them to repeat instead of guessing. Be friendly, warm, and local — not American call center tone.`
      : 'You are a helpful receptionist at a Zambian business. Always collect phone number first and use Kwacha for prices.';

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