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

    const { companyId, notificationType, data, mediaUrl } = await req.json();

    console.log('Sending boss notification:', { companyId, notificationType });

    // Get company and boss phone
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('name, boss_phone, whatsapp_number')
      .eq('id', companyId)
      .single();

    if (companyError || !company || !company.boss_phone) {
      console.log('No boss phone configured for company:', companyId);
      return new Response(JSON.stringify({ success: false, message: 'No boss phone' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let message = '';

    switch (notificationType) {
      case 'new_reservation':
        message = `🎉 New Reservation!\n\nName: ${data.name}\nPhone: ${data.phone}\nGuests: ${data.guests}\nDate: ${data.date}\nTime: ${data.time}\n${data.area_preference ? `Area: ${data.area_preference}\n` : ''}${data.occasion ? `Occasion: ${data.occasion}` : ''}`;
        break;
      
      case 'interested_client':
        message = `👀 Interested Client Alert!\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.phone}\nInterest: ${data.information}`;
        break;
      
      case 'conversation_summary':
        message = `📊 Conversation Summary\n\nCustomer: ${data.customer_name || 'Unknown'}\nDuration: ${data.duration}s\nQuality: ${data.quality_flag || 'N/A'}\n\nKey Points:\n${data.summary}`;
        break;
      
      case 'action_required':
        message = `⚠️ Action Required!\n\nType: ${data.action_type}\nPriority: ${data.priority}\n\n${data.description}\n\nCustomer: ${data.customer_name || 'N/A'}\nPhone: ${data.customer_phone || 'N/A'}`;
        break;
      
      case 'payment_request':
        message = `💰 Payment Request!\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.customer_phone}${data.customer_email ? `\nEmail: ${data.customer_email}` : ''}\n\nProduct: ${data.product_name}\nAmount: ${data.currency_prefix || 'K'}${data.amount}\nPayment Method: ${data.payment_method?.toUpperCase() || 'Not specified'}\n\nPlease contact the customer to complete the payment.`;
        break;
      
      case 'payment_proof_uploaded':
        message = `💳 Payment Proof Uploaded\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.customer_phone}\nAmount: ${data.currency_prefix || 'K'}${data.amount}\nMethod: ${data.payment_method?.toUpperCase()}\n\n${data.proof_url ? `Proof: ${data.proof_url}\n\n` : ''}Reply:\n✅ VERIFY ${data.transaction_id?.slice(0, 8) || 'ID'}\n❌ REJECT ${data.transaction_id?.slice(0, 8) || 'ID'} [reason]`;
        break;
      
      case 'high_value_opportunity':
        message = `💎 High-Value Opportunity!\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.customer_phone}\nType: ${data.opportunity_type}\n\n${data.details}\n\nEstimated Value: ${data.estimated_value || 'TBD'}`;
        break;
      
      case 'customer_complaint':
        message = `⚠️ Customer Issue Detected\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.customer_phone}\nSentiment: Negative\n\nIssue: ${data.issue_summary}\n\nRequires immediate attention!`;
        break;
      
      case 'vip_client_info':
        message = `⭐ Important Client Information\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.customer_phone}\nInfo Type: ${data.info_type}\n\n${data.information}`;
        break;
      
      case 'reservation_modified':
        message = `🔄 Reservation Modification\n\nCustomer: ${data.customer_name}\nOriginal: ${data.original_date} at ${data.original_time}\nRequested: ${data.new_date} at ${data.new_time}\n\nReason: ${data.reason || 'Not provided'}\n\nReply: APPROVE or REJECT`;
        break;
      
      case 'low_credit_alert':
        message = `🔋 Low Credit Balance Alert\n\nCurrent Balance: ${data.credit_balance} credits\nUsage Rate: ${data.usage_rate} credits/day\n\nEstimated days remaining: ${data.days_remaining}\n\nPlease top up to avoid service interruption.`;
        break;
      
      case 'system_recalibration':
        message = `🚨 #SYSTEM_RECALIBRATION_REQUIRED\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.customer_phone}\nConsecutive Errors: ${data.error_count || 2}\nError Types: ${(data.error_types || []).join(', ')}\n\n${data.trigger_reason || 'Multiple consecutive AI errors detected.'}\n\nRecommendation: Manual human takeover advised.\n\nReply: TAKEOVER ${data.customer_phone}`;
        break;
      
      default:
        message = data.message || 'Notification from AI assistant';
    }

    // Send via Twilio
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      
      const formData = new URLSearchParams();
      // Normalize From number - ensure whatsapp: prefix exactly once
      const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
        ? company.whatsapp_number 
        : `whatsapp:${company.whatsapp_number}`;
      
      // Normalize To number - strip any existing whatsapp: prefix, ensure E.164 with +, then add whatsapp:
      const cleanBossPhone = company.boss_phone.replace(/^whatsapp:/, '').replace(/^\+?/, '+');
      const toNumber = `whatsapp:${cleanBossPhone}`;
      
      formData.append('From', fromNumber);
      formData.append('To', toNumber);
      formData.append('Body', message);
      if (mediaUrl || data?.mediaUrl) {
        formData.append('MediaUrl', mediaUrl || data.mediaUrl);
      }

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!twilioResponse.ok) {
        const errorText = await twilioResponse.text();
        console.error('Twilio error:', errorText);
      } else {
        console.log('Management notification sent successfully');
      }
    }

    // Log notification
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: companyId,
        message_from: 'ai',
        message_content: message,
        response: null
      });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in send-management-notification:", error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
