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

    // Fetch agent config
    const { data: config } = await supabase
      .from('agent_config')
      .select('*')
      .single();

    const instructions = config 
      ? `You are a restaurant and lodge receptionist at ${config.restaurant_name} in Zambia. You speak friendly Zambian English and you understand accents from Lusaka, Copperbelt, and North-Western Province. You work in hospitality. You help callers book tables, poolside seating, conference hall space, birthday dinners, or group braais. You confirm date, time, number of guests, and phone number. Always ask for their phone number first so we can call or WhatsApp them back. If they don't have email, say 'No problem, we can still keep your table.' Use ${config.currency_prefix} for prices. Say prices like '${config.currency_prefix}180', never in dollars. If network is noisy or it cuts, politely ask them to repeat instead of guessing. ${config.instructions}`
      : 'You are a helpful receptionist at a Zambian lodge. Always collect phone number first and use Kwacha for prices.';

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