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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');

    if (!MONEYUNIFY_API_KEY) {
      throw new Error('MoneyUnify Auth Key not configured');
    }

    console.log('MoneyUnify Auth Key configured:', MONEYUNIFY_API_KEY ? 'Yes' : 'No');

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

    // Try MoneyUnify API with X-Auth-Key header (most common pattern)
    console.log('Calling MoneyUnify API endpoint: https://api.moneyunify.com/v1/collections/request');
    console.log('Request payload:', JSON.stringify({
      amount,
      currency: currency || 'ZMW',
      mobile_number,
      provider,
      reference,
      description
    }, null, 2));

    const moneyunifyResponse = await fetch('https://api.moneyunify.com/v1/collections/request', {
      method: 'POST',
      headers: {
        'X-Auth-Key': MONEYUNIFY_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
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

    console.log('MoneyUnify Response Status:', moneyunifyResponse.status);
    console.log('MoneyUnify Response Headers:', JSON.stringify(Object.fromEntries(moneyunifyResponse.headers.entries())));

    const responseText = await moneyunifyResponse.text();
    console.log('MoneyUnify Response Body (raw):', responseText);

    if (!moneyunifyResponse.ok) {
      console.error('MoneyUnify API error details:', {
        status: moneyunifyResponse.status,
        statusText: moneyunifyResponse.statusText,
        headers: Object.fromEntries(moneyunifyResponse.headers.entries()),
        body: responseText
      });
      throw new Error(`MoneyUnify API error: ${moneyunifyResponse.status} - ${responseText.substring(0, 200)}`);
    }

    let moneyunifyData;
    try {
      moneyunifyData = JSON.parse(responseText);
      console.log('MoneyUnify response (parsed):', JSON.stringify(moneyunifyData, null, 2));
    } catch (parseError) {
      console.error('Failed to parse MoneyUnify response as JSON:', parseError);
      throw new Error(`Invalid JSON response from MoneyUnify: ${responseText.substring(0, 200)}`);
    }

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