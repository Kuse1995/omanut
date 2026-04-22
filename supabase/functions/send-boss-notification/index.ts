import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getBossPhones } from "../_shared/boss-phones.ts";
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

    // Get company whatsapp number
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('name, whatsapp_number')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      console.log('Company not found:', companyId);
      return new Response(JSON.stringify({ success: false, message: 'Company not found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get boss phones from the new table — filter by notification type
    const phoneFilter: any = {};
    switch (notificationType) {
      case 'new_reservation':
      case 'reservation_modified':
        phoneFilter.notify_reservations = true;
        break;
      case 'payment_request':
      case 'payment_proof_uploaded':
        phoneFilter.notify_payments = true;
        break;
      case 'social_media_alert':
        phoneFilter.notify_social_media = true;
        break;
      case 'content_approval_request':
        phoneFilter.notify_content_approval = true;
        break;
      case 'interested_client':
      case 'conversation_summary':
      case 'action_required':
      case 'high_value_opportunity':
      case 'customer_complaint':
      case 'vip_client_info':
      case 'low_credit_alert':
      case 'system_recalibration':
      default:
        phoneFilter.notify_alerts = true;
        break;
    }
    const bossPhones = await getBossPhones(supabase, companyId, phoneFilter);

    if (bossPhones.length === 0) {
      console.log('No boss phones configured for company/type:', companyId, notificationType);
      return new Response(JSON.stringify({ success: false, message: 'No matching boss phone' }), {
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

      case 'social_media_alert':
        message = `📣 Social Media Update\n\n${data.title || 'Action needed on social media'}\n\n${data.details || data.message || ''}${data.platform ? `\n\nPlatform: ${data.platform}` : ''}${data.link ? `\n\nLink: ${data.link}` : ''}`;
        break;

      case 'content_approval_request':
        message = `✍️ Content Awaiting Approval\n\n${data.platform ? `Platform: ${data.platform}\n` : ''}${data.scheduled_for ? `Scheduled: ${data.scheduled_for}\n` : ''}\nDraft:\n${data.caption || data.content || data.details || ''}\n\nReply APPROVE to publish or REJECT to discard.`;
        break;

      default:
        message = data.message || 'Notification from AI assistant';
    }

    // Send via Twilio to ALL boss phones
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      
      // Normalize From number
      const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
        ? company.whatsapp_number 
        : `whatsapp:${company.whatsapp_number}`;

      for (const bossPhone of bossPhones) {
        // Normalize To number
        const cleanBossPhone = bossPhone.phone.replace(/^whatsapp:/, '').replace(/^\+?/, '+');
        const toNumber = `whatsapp:${cleanBossPhone}`;
        
        const formData = new URLSearchParams();
        formData.append('From', fromNumber);
        formData.append('To', toNumber);
        formData.append('Body', message);
        if (mediaUrl || data?.mediaUrl) {
          formData.append('MediaUrl', mediaUrl || data.mediaUrl);
        }

        try {
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
            console.error(`Twilio error for ${bossPhone.phone}:`, errorText);
          } else {
            console.log(`Management notification sent to ${bossPhone.label || bossPhone.phone}`);
          }
        } catch (e) {
          console.error(`Failed to send to ${bossPhone.phone}:`, e);
        }
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
