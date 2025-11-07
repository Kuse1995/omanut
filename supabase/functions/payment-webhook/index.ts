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

    // Parse webhook payload from MoneyUnify
    const payload = await req.json();
    
    console.log('Payment webhook received:', payload);

    const {
      event,
      transaction_id,
      reference,
      status,
      amount,
      currency,
      mobile_number,
      provider,
      timestamp
    } = payload;

    // Find the payment transaction by reference
    const { data: transaction, error: fetchError } = await supabase
      .from('payment_transactions')
      .select('*, companies(*)')
      .eq('payment_reference', reference)
      .single();

    if (fetchError || !transaction) {
      console.error('Transaction not found for reference:', reference);
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404 
        }
      );
    }

    console.log('Found transaction:', transaction.id, 'Status:', status);

    // Update transaction status based on webhook event
    let paymentStatus = 'pending';
    let completedAt = null;

    if (event === 'collection.completed' && status === 'successful') {
      paymentStatus = 'completed';
      completedAt = new Date().toISOString();
    } else if (status === 'failed') {
      paymentStatus = 'failed';
    } else if (status === 'cancelled') {
      paymentStatus = 'cancelled';
    }

    // Update the transaction
    const { error: updateError } = await supabase
      .from('payment_transactions')
      .update({
        payment_status: paymentStatus,
        completed_at: completedAt,
        moneyunify_transaction_id: transaction_id,
        metadata: {
          ...transaction.metadata,
          webhook_event: event,
          webhook_timestamp: timestamp
        }
      })
      .eq('id', transaction.id);

    if (updateError) {
      console.error('Error updating transaction:', updateError);
      throw updateError;
    }

    console.log('Transaction updated to status:', paymentStatus);

    // If payment successful, trigger post-payment workflow
    if (paymentStatus === 'completed') {
      console.log('Payment successful, triggering post-payment workflow');

      // Get product details
      const { data: product } = await supabase
        .from('payment_products')
        .select('*')
        .eq('id', transaction.product_id)
        .single();

      // Send confirmation message to customer via WhatsApp
      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && transaction.companies.whatsapp_number) {
        const confirmationMessage = `✅ Payment received! Your *${product?.name || 'order'}* for ${transaction.currency}${transaction.amount} is now in production.\n\n📅 Estimated delivery: 2-3 business days\n📞 We'll keep you updated via WhatsApp!\n\nThank you for your order! 🎉`;

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        
        const formData = new URLSearchParams();
        const fromNumber = transaction.companies.whatsapp_number.startsWith('whatsapp:') 
          ? transaction.companies.whatsapp_number 
          : `whatsapp:${transaction.companies.whatsapp_number}`;
        formData.append('From', fromNumber);
        formData.append('To', transaction.customer_phone);
        formData.append('Body', confirmationMessage);

        try {
          const twilioResponse = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });

          if (twilioResponse.ok) {
            console.log('Confirmation message sent to customer');
          } else {
            console.error('Failed to send confirmation message');
          }
        } catch (twilioError) {
          console.error('Error sending confirmation:', twilioError);
        }
      }

      // Create action item for production team
      await supabase
        .from('action_items')
        .insert({
          company_id: transaction.company_id,
          conversation_id: transaction.conversation_id,
          action_type: 'production',
          description: `Create ${product?.name || 'product'} for ${transaction.customer_name || 'customer'}`,
          customer_name: transaction.customer_name,
          customer_phone: transaction.customer_phone,
          status: 'pending',
          priority: 'high'
        });

      console.log('Action item created for production team');

      // Notify management/boss
      if (transaction.companies.boss_phone) {
        const bossMessage = `💰 New Payment Received!\n\nProduct: ${product?.name || 'Unknown'}\nAmount: ${transaction.currency}${transaction.amount}\nCustomer: ${transaction.customer_name || 'Unknown'} (${transaction.customer_phone})\nPayment Method: ${transaction.payment_method}\n\nAction item created for production team.`;

        const bossFormData = new URLSearchParams();
        const fromNumber = transaction.companies.whatsapp_number.startsWith('whatsapp:') 
          ? transaction.companies.whatsapp_number 
          : `whatsapp:${transaction.companies.whatsapp_number}`;
        bossFormData.append('From', fromNumber);
        bossFormData.append('To', `whatsapp:${transaction.companies.boss_phone}`);
        bossFormData.append('Body', bossMessage);

        try {
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: bossFormData.toString(),
          });
          console.log('Boss notification sent');
        } catch (error) {
          console.error('Failed to send boss notification:', error);
        }
      }
    }

    // Return success to MoneyUnify
    return new Response(
      JSON.stringify({ success: true, message: 'Webhook processed' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in payment-webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});