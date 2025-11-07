import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const {
      company_id,
      conversation_id,
      product_id,
      customer_phone,
      customer_name,
      customer_email,
      payment_method,
      amount,
      metadata
    } = await req.json();

    console.log('Creating payment link:', { company_id, product_id, payment_method, amount });

    // Fetch product details
    const { data: product, error: productError } = await supabase
      .from('payment_products')
      .select('*')
      .eq('id', product_id)
      .single();

    if (productError || !product) {
      throw new Error('Product not found');
    }

    // Fetch company details
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*')
      .eq('id', company_id)
      .single();

    if (companyError || !company) {
      throw new Error('Company not found');
    }

    let paymentLink = '';
    let paymentReference = '';
    let ussdCode = '';
    let moneyunifyTransactionId = '';

    // Determine payment method and generate appropriate link
    if (payment_method === 'selar' || !payment_method) {
      // Use Selar link (international payments with webhook tracking)
      if (product.selar_link) {
        paymentLink = product.selar_link;
      } else {
        throw new Error('Selar link not configured for this product');
      }
      // Generate trackable reference for webhook matching
      const companyShort = company_id.substring(0, 8);
      const productShort = product_id.substring(0, 8);
      paymentReference = `SELAR_${companyShort}_${productShort}_${Date.now()}`;
    } else if (['mtn', 'airtel', 'zamtel'].includes(payment_method)) {
      // Use MoneyUnify for mobile money
      console.log('Initiating MoneyUnify payment for', payment_method);
      
      const moneyunifyResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/initiate-mobile-money`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amount,
            currency: product.currency,
            mobile_number: customer_phone.replace('whatsapp:', ''),
            provider: payment_method,
            description: `Payment for ${product.name}`,
            company_id: company_id
          })
        }
      );

      if (!moneyunifyResponse.ok) {
        throw new Error('Failed to initiate mobile money payment');
      }

      const moneyunifyData = await moneyunifyResponse.json();
      paymentReference = moneyunifyData.reference;
      ussdCode = moneyunifyData.ussd_code || '';
      moneyunifyTransactionId = moneyunifyData.transaction_id || '';
      paymentLink = `Mobile Money: ${payment_method.toUpperCase()}`;
    } else {
      throw new Error('Invalid payment method');
    }

    // Create payment transaction record with enhanced metadata for webhook matching
    const { data: transaction, error: transactionError } = await supabase
      .from('payment_transactions')
      .insert({
        company_id: company_id,
        conversation_id: conversation_id,
        product_id: product_id,
        customer_phone: customer_phone,
        customer_name: customer_name,
        amount: amount,
        currency: product.currency,
        payment_method: payment_method,
        payment_status: 'pending',
        payment_reference: paymentReference,
        payment_link: paymentLink,
        moneyunify_transaction_id: moneyunifyTransactionId,
        metadata: {
          ...metadata,
          customer_email: customer_email,
          product_name: product.name,
          ussd_code: ussdCode,
          created_for_webhook_matching: true
        }
      })
      .select()
      .single();

    if (transactionError) {
      console.error('Error creating transaction:', transactionError);
      throw transactionError;
    }

    console.log('Payment transaction created:', transaction.id);

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        payment_link: paymentLink,
        payment_reference: paymentReference,
        ussd_code: ussdCode,
        payment_method: payment_method,
        amount: amount,
        currency: product.currency
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