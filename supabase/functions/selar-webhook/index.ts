import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-selar-signature',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SELAR_API_KEY = Deno.env.get('SELAR_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!SELAR_API_KEY) {
      throw new Error('SELAR_API_KEY not configured');
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get webhook payload
    const payload = await req.json();
    
    // LOG EVERYTHING to understand Selar's webhook structure
    console.log('=== SELAR WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('=============================');

    // Verify webhook signature (if Selar provides one)
    const signature = req.headers.get('x-selar-signature') || req.headers.get('X-Selar-Signature');
    if (signature) {
      console.log('Selar signature found:', signature);
      // TODO: Implement signature verification once we know the algorithm
    }

    // Extract payment information from webhook
    // These field names are guesses - will be corrected based on actual webhook
    const {
      transaction_id,
      order_id,
      reference,
      status,
      amount,
      currency,
      customer_email,
      customer_phone,
      product_name,
      product_id,
      created_at,
      updated_at,
    } = payload;

    console.log('Extracted fields:', {
      transaction_id,
      order_id,
      reference,
      status,
      amount,
      currency,
      customer_email,
      customer_phone,
      product_name
    });

    // Only process completed/successful payments
    const successStatuses = ['completed', 'success', 'successful', 'paid'];
    if (!status || !successStatuses.includes(status.toLowerCase())) {
      console.log('Payment not completed, status:', status);
      return new Response(
        JSON.stringify({ message: 'Payment not completed', status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find matching transaction in our database
    // Strategy: Match by customer phone, amount, and recent timestamp
    let transaction;

    // Try 1: Match by reference if available
    if (reference) {
      console.log('Trying to match by reference:', reference);
      const { data } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('payment_reference', reference)
        .single();
      
      if (data) {
        transaction = data;
        console.log('Found transaction by reference:', transaction.id);
      }
    }

    // Try 2: Match by customer phone + amount + within last 24 hours
    if (!transaction && customer_phone && amount) {
      console.log('Trying to match by phone and amount:', { customer_phone, amount });
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('customer_phone', customer_phone)
        .eq('amount', amount)
        .eq('payment_status', 'pending')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (data) {
        transaction = data;
        console.log('Found transaction by phone+amount:', transaction.id);
      }
    }

    // Try 3: Match by email + amount if phone not available
    if (!transaction && customer_email && amount) {
      console.log('Trying to match by email and amount:', { customer_email, amount });
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data } = await supabase
        .from('payment_transactions')
        .select('*')
        .ilike('metadata->>customer_email', customer_email)
        .eq('amount', amount)
        .eq('payment_status', 'pending')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (data) {
        transaction = data;
        console.log('Found transaction by email+amount:', transaction.id);
      }
    }

    if (!transaction) {
      console.error('No matching transaction found for Selar payment:', {
        reference,
        customer_phone,
        customer_email,
        amount
      });
      
      // Still return 200 to prevent Selar retries
      return new Response(
        JSON.stringify({ 
          message: 'Transaction not found',
          webhook_data: payload
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already processed (idempotency)
    if (transaction.payment_status === 'completed') {
      console.log('Transaction already completed:', transaction.id);
      return new Response(
        JSON.stringify({ message: 'Transaction already processed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update transaction status
    const { error: updateError } = await supabase
      .from('payment_transactions')
      .update({
        payment_status: 'completed',
        completed_at: new Date().toISOString(),
        metadata: {
          ...transaction.metadata,
          selar_transaction_id: transaction_id,
          selar_order_id: order_id,
          selar_webhook_payload: payload,
          selar_webhook_received_at: new Date().toISOString()
        }
      })
      .eq('id', transaction.id);

    if (updateError) {
      console.error('Error updating transaction:', updateError);
      throw updateError;
    }

    console.log('Transaction updated to completed:', transaction.id);

    // Fetch product details
    const { data: product } = await supabase
      .from('payment_products')
      .select('*')
      .eq('id', transaction.product_id)
      .single();

    // Fetch company details
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', transaction.company_id)
      .single();

    // Send confirmation to customer via WhatsApp
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company?.whatsapp_number) {
      try {
        const confirmationMessage = `✅ Payment confirmed! Thank you for your payment of ${transaction.currency} ${transaction.amount} for ${product?.name || 'your purchase'}. Your order is being processed. Reference: ${transaction.payment_reference}`;

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${twilioAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: `whatsapp:${company.whatsapp_number}`,
            To: `whatsapp:${transaction.customer_phone}`,
            Body: confirmationMessage,
          }),
        });

        if (twilioResponse.ok) {
          console.log('WhatsApp confirmation sent to customer');
        } else {
          const errorText = await twilioResponse.text();
          console.error('Failed to send WhatsApp confirmation:', errorText);
        }
      } catch (twilioError) {
        console.error('Error sending WhatsApp confirmation:', twilioError);
      }
    }

    // Create action item for production team
    const { error: actionError } = await supabase
      .from('action_items')
      .insert({
        company_id: transaction.company_id,
        conversation_id: transaction.conversation_id,
        action_type: 'order_received',
        description: `New order: ${product?.name || 'Product'} - ${transaction.currency} ${transaction.amount}`,
        customer_name: transaction.customer_name,
        customer_phone: transaction.customer_phone,
        priority: 'high',
        status: 'pending',
        notes: `Payment via Selar. Reference: ${transaction.payment_reference}. Transaction ID: ${transaction_id || 'N/A'}`
      });

    if (actionError) {
      console.error('Error creating action item:', actionError);
    } else {
      console.log('Action item created for production team');
    }

    // Notify boss/management
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company?.boss_phone && company?.whatsapp_number) {
      try {
        const bossMessage = `💰 New payment received!\n\nProduct: ${product?.name || 'Product'}\nAmount: ${transaction.currency} ${transaction.amount}\nCustomer: ${transaction.customer_name || 'Unknown'}\nPhone: ${transaction.customer_phone}\nMethod: Selar (International)\nReference: ${transaction.payment_reference}`;

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${twilioAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: `whatsapp:${company.whatsapp_number}`,
            To: `whatsapp:${company.boss_phone}`,
            Body: bossMessage,
          }),
        });

        if (twilioResponse.ok) {
          console.log('Notification sent to boss');
        } else {
          const errorText = await twilioResponse.text();
          console.error('Failed to send boss notification:', errorText);
        }
      } catch (twilioError) {
        console.error('Error sending boss notification:', twilioError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Payment processed successfully',
        transaction_id: transaction.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing Selar webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: 'Check edge function logs for full error details'
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
