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

    const { transactionId, companyId } = await req.json();

    if (!transactionId || !companyId) {
      return new Response(
        JSON.stringify({ error: 'Transaction ID and Company ID are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[DELIVER] Starting delivery for transaction:', transactionId);

    // Fetch transaction with product details
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .select(`
        *,
        product:payment_products(*)
      `)
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      console.error('[DELIVER] Transaction not found:', txError);
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const product = transaction.product;
    
    if (!product || product.product_type !== 'digital') {
      console.log('[DELIVER] Not a digital product, skipping delivery');
      return new Response(
        JSON.stringify({ success: true, message: 'Not a digital product' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch company details
    const { data: company } = await supabase
      .from('companies')
      .select('whatsapp_number, name')
      .eq('id', companyId)
      .single();

    // Generate secure download URL
    let downloadUrl = product.download_url;
    
    if (product.digital_file_path && !downloadUrl) {
      // Generate signed URL from storage
      const { data: signedUrlData, error: signedUrlError } = await supabase
        .storage
        .from('digital-products')
        .createSignedUrl(
          product.digital_file_path,
          (product.download_expiry_hours || 48) * 3600 // Convert hours to seconds
        );

      if (signedUrlError) {
        console.error('[DELIVER] Error generating signed URL:', signedUrlError);
        throw new Error('Failed to generate download link');
      }

      downloadUrl = signedUrlData.signedUrl;
    }

    if (!downloadUrl) {
      console.error('[DELIVER] No download URL available for product');
      return new Response(
        JSON.stringify({ error: 'No download URL configured for this product' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate expiry
    const expiryHours = product.download_expiry_hours || 48;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    // Create delivery record
    const { data: delivery, error: deliveryError } = await supabase
      .from('digital_product_deliveries')
      .insert({
        transaction_id: transactionId,
        product_id: product.id,
        company_id: companyId,
        customer_phone: transaction.customer_phone,
        customer_email: transaction.metadata?.email || null,
        delivery_method: 'whatsapp',
        download_url: downloadUrl,
        max_downloads: product.download_limit || 3,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (deliveryError) {
      console.error('[DELIVER] Error creating delivery record:', deliveryError);
      throw new Error('Failed to create delivery record');
    }

    console.log('[DELIVER] Created delivery record:', delivery.id);

    // Send WhatsApp message with download link
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company?.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const formData = new URLSearchParams();
      
      const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
        ? company.whatsapp_number 
        : `whatsapp:${company.whatsapp_number}`;
      
      formData.append('From', fromNumber);
      formData.append('To', `whatsapp:${transaction.customer_phone}`);
      
      // Send the actual file via MediaUrl if it's a direct URL
      // Twilio will fetch and deliver the file directly to the customer
      if (downloadUrl.includes('supabase.co') || downloadUrl.startsWith('http')) {
        console.log('[DELIVER] Sending actual file via Twilio MediaUrl');
        formData.append('MediaUrl', downloadUrl);
        formData.append('Body', `🎉 Thank you for your purchase!\n\n📦 *Product:* ${product.name}\n\nYour file is attached above! 📎\n\n⏰ Download expires in ${expiryHours} hours\n📥 Downloads remaining: ${product.download_limit || 3}\n\nIf you have any questions, feel free to reach out!`);
      } else {
        // Fallback to link if URL is not directly accessible
        const deliveryMessage = `🎉 Thank you for your purchase!\n\n📦 *Product:* ${product.name}\n\nHere's your download link:\n${downloadUrl}\n\n⏰ This link expires in ${expiryHours} hours\n📥 Downloads remaining: ${product.download_limit || 3}\n\nIf you have any questions, feel free to reach out!`;
        formData.append('Body', deliveryMessage);
      }

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (twilioResponse.ok) {
        console.log('[DELIVER] Download link sent via WhatsApp');
      } else {
        const errorText = await twilioResponse.text();
        console.error('[DELIVER] Twilio error:', errorText);
      }
    }

    // Update transaction with delivery info
    await supabase
      .from('payment_transactions')
      .update({
        metadata: {
          ...(transaction.metadata || {}),
          digital_delivery_id: delivery.id,
          delivered_at: new Date().toISOString()
        }
      })
      .eq('id', transactionId);

    console.log('[DELIVER] Delivery complete for transaction:', transactionId);

    return new Response(
      JSON.stringify({
        success: true,
        deliveryId: delivery.id,
        downloadUrl,
        expiresAt: expiresAt.toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[DELIVER] Error:', error);
    const errorMessage = 'An error occurred processing your request';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
