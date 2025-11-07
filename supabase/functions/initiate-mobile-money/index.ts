import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MONEYUNIFY_API_KEY = Deno.env.get('MONEYUNIFY_API_KEY');
    const MONEYUNIFY_SECRET_KEY = Deno.env.get('MONEYUNIFY_SECRET_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const PROJECT_ID = Deno.env.get('VITE_SUPABASE_PROJECT_ID');

    if (!MONEYUNIFY_API_KEY || !MONEYUNIFY_SECRET_KEY) {
      throw new Error('MoneyUnify credentials not configured');
    }

    const {
      amount,
      currency,
      mobile_number,
      provider,
      description,
      company_id
    } = await req.json();

    console.log('Initiating mobile money collection:', { 
      amount, 
      currency, 
      mobile_number, 
      provider,
      description 
    });

    // Generate unique reference
    const reference = `TXN_${company_id.substring(0, 8)}_${Date.now()}`;

    // Prepare callback URL for webhook
    const callbackUrl = `${SUPABASE_URL}/functions/v1/payment-webhook`;

    // Call MoneyUnify API to initiate collection
    const moneyunifyResponse = await fetch('https://api.moneyunify.com/v1/collections/request', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MONEYUNIFY_API_KEY}`,
        'X-Secret-Key': MONEYUNIFY_SECRET_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount,
        currency: currency || 'ZMW',
        mobile_number: mobile_number,
        provider: provider, // 'mtn', 'airtel', or 'zamtel'
        reference: reference,
        description: description,
        callback_url: callbackUrl
      })
    });

    if (!moneyunifyResponse.ok) {
      const errorText = await moneyunifyResponse.text();
      console.error('MoneyUnify API error:', moneyunifyResponse.status, errorText);
      throw new Error(`MoneyUnify API error: ${moneyunifyResponse.status}`);
    }

    const moneyunifyData = await moneyunifyResponse.json();
    
    console.log('MoneyUnify response:', moneyunifyData);

    return new Response(
      JSON.stringify({
        success: true,
        reference: reference,
        transaction_id: moneyunifyData.transaction_id,
        ussd_code: moneyunifyData.ussd_code,
        status: moneyunifyData.status,
        message: moneyunifyData.message || 'Customer will receive prompt on their phone'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in initiate-mobile-money:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});