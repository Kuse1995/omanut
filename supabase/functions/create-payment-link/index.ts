import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      company_id,
      product_id,
      customer_name,
      customer_phone,
      customer_email,
      amount,
      payment_method, // 'manual_mtn', 'manual_airtel', 'manual_zamtel'
      conversation_id
    } = await req.json();

    console.log('Creating manual payment transaction:', {
      company_id,
      product_id,
      customer_phone,
      payment_method,
      amount
    });

    // Fetch product details
    const { data: product, error: productError } = await supabase
      .from('payment_products')
      .select('*')
      .eq('id', product_id)
      .single();

    if (productError) {
      console.error('Error fetching product:', productError);
      throw new Error('Product not found');
    }

    // Fetch company details and payment numbers
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('name, payment_number_mtn, payment_number_airtel, payment_number_zamtel, payment_instructions')
      .eq('id', company_id)
      .single();

    if (companyError) {
      console.error('Error fetching company:', companyError);
      throw new Error('Company not found');
    }

    // Determine designated number based on payment method
    let designated_number = '';
    let provider_name = '';
    
    if (payment_method === 'manual_mtn') {
      designated_number = company.payment_number_mtn || '';
      provider_name = 'MTN';
    } else if (payment_method === 'manual_airtel') {
      designated_number = company.payment_number_airtel || '';
      provider_name = 'Airtel';
    } else if (payment_method === 'manual_zamtel') {
      designated_number = company.payment_number_zamtel || '';
      provider_name = 'Zamtel';
    }

    if (!designated_number) {
      throw new Error(`${provider_name} payment number not configured for this company`);
    }

    // Generate unique reference
    const reference = `TXN_${company_id.substring(0, 8)}_${Date.now()}`;

    // Create transaction record
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .insert({
        company_id,
        product_id,
        conversation_id,
        customer_name,
        customer_phone,
        amount: amount || product.price,
        currency: product.currency || 'ZMW',
        payment_method,
        payment_status: 'pending',
        payment_reference: reference,
        designated_number,
        verification_status: 'pending',
        metadata: {
          product_name: product.name,
          customer_email
        }
      })
      .select()
      .single();

    if (txError) {
      console.error('Error creating transaction:', txError);
      throw new Error('Failed to create transaction');
    }

    // Prepare payment instructions
    const instructions = company.payment_instructions || 'Send payment to the designated number and upload proof of payment for verification.';
    
    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        reference: reference,
        amount: transaction.amount,
        currency: transaction.currency,
        designated_number,
        provider: provider_name,
        instructions: `
💰 Amount: ${transaction.currency} ${transaction.amount}
📱 Send to: ${designated_number} (${provider_name})

${instructions}

📋 Reference: ${reference}

⏱️ Verification Time: Within 30 minutes during business hours

How to send proof:
1. Send money using ${provider_name} mobile money
2. Take a screenshot of the confirmation SMS/message
3. Upload here or send via WhatsApp
4. Wait for verification (typically under 30 minutes)

Your order will be processed once payment is verified.
        `.trim()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in create-payment-link:', error);
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
