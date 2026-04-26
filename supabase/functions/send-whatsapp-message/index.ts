import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function normalizeWhatsAppTo(phone: string): string {
  const clean = phone.replace(/^whatsapp:/, '');
  return clean.startsWith('+') ? `whatsapp:${clean}` : `whatsapp:+${clean}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { conversationId, message, mediaUrl, phone, company_id, media_url } = await req.json();
    const effectiveMediaUrl = mediaUrl || media_url;

    // Determine auth mode: JWT (admin panel) or service-role (MCP/internal)
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    let isServiceRole = false;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      // Check if it's the service role key
      if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
        isServiceRole = true;
        console.log('[send-whatsapp-message] Service-role auth');
      } else {
        // Validate as user JWT
        const userClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user }, error: authError } = await userClient.auth.getUser(token);
        if (authError || !user) {
          console.error('Auth validation failed:', authError);
          return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        userId = user.id;
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve conversation: by ID, or by phone+company_id lookup.
    // SECURITY: never auto-create a conversation for an unknown (phone, company_id) pair —
    // that's how cross-tenant message leaks happen. Existing binding required.
    let conversation: any = null;
    const callerScope = isServiceRole ? 'service_role' : 'user_jwt';

    const auditDecision = async (decision: string, reason: string, resolvedCompanyId: string | null, customerPhone: string | null, extra: Record<string, unknown> = {}) => {
      try {
        await supabase.from('cross_tenant_audit').insert({
          source: 'send-whatsapp-message',
          caller_scope: callerScope,
          asserted_company_id: company_id || null,
          resolved_company_id: resolvedCompanyId,
          customer_phone: customerPhone,
          decision,
          reason,
          details: { user_id: userId, conversation_id: conversationId || null, ...extra }
        });
      } catch (_) { /* best effort */ }
    };

    if (conversationId) {
      const { data, error } = await supabase
        .from('conversations')
        .select('*, companies(twilio_number, whatsapp_number)')
        .eq('id', conversationId)
        .single();
      if (error || !data) {
        console.error('Error fetching conversation:', error);
        await auditDecision('blocked', 'conversation_not_found', null, null);
        return new Response(
          JSON.stringify({ error: 'Conversation not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // If caller asserted a company_id, it MUST match the conversation's owner.
      if (company_id && data.company_id !== company_id) {
        console.error('[SECURITY] Conversation/company mismatch', { conversationId, asserted: company_id, actual: data.company_id });
        await auditDecision('blocked', 'conversation_company_mismatch', data.company_id, data.phone, { actual_company_id: data.company_id });
        return new Response(
          JSON.stringify({ error: 'CROSS_TENANT_DENIED', message: 'Conversation does not belong to the asserted company.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      conversation = data;
    } else if (phone && company_id) {
      const cleanPhone = phone.replace(/^whatsapp:/, '');

      const { data: convs } = await supabase
        .from('conversations')
        .select('*, companies(twilio_number, whatsapp_number)')
        .eq('company_id', company_id)
        .or(`phone.eq.${cleanPhone},phone.eq.whatsapp:${cleanPhone}`)
        .order('started_at', { ascending: false })
        .limit(1);

      if (convs && convs.length > 0) {
        conversation = convs[0];
      } else {
        // SECURITY: do NOT auto-create. Require an existing customer<->company binding.
        console.warn('[SECURITY] NO_CUSTOMER_BINDING', { company_id, phone: cleanPhone, callerScope });
        await auditDecision('blocked', 'no_customer_binding', company_id, cleanPhone);
        return new Response(
          JSON.stringify({
            error: 'NO_CUSTOMER_BINDING',
            message: 'This customer has no existing conversation with the specified company. Unsolicited cross-tenant messaging is not allowed.'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'conversationId or (phone + company_id) required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!message && !effectiveMediaUrl) {
      return new Response(
        JSON.stringify({ error: 'message or mediaUrl required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Authorization check: JWT users must belong to the company (or be a platform admin)
    if (userId && !isServiceRole) {
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();

      if (!adminRole) {
        const { data: accessData } = await supabase
          .from('company_users')
          .select('id')
          .eq('user_id', userId)
          .eq('company_id', conversation.company_id)
          .maybeSingle();

        if (!accessData) {
          await auditDecision('blocked', 'user_not_in_company', conversation.company_id, conversation.phone);
          return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        await auditDecision('allowed', 'admin_role_override', conversation.company_id, conversation.phone, { admin_user_id: userId });
      }
    }

    await auditDecision('allowed', 'binding_verified', conversation.company_id, conversation.phone);

    // Insert message into database
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'assistant',
        content: message || (effectiveMediaUrl ? 'Sent an attachment' : '')
      });

    if (msgError) {
      console.error('Error inserting message:', msgError);
      return new Response(
        JSON.stringify({ error: 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // === PROVIDER ROUTING ===
    // If this company has opted into the direct Meta WhatsApp Cloud API,
    // delegate to send-whatsapp-cloud. Otherwise fall through to Twilio (default).
    const { data: companyRow } = await supabase
      .from('companies')
      .select('whatsapp_provider')
      .eq('id', conversation.company_id)
      .maybeSingle();

    if (companyRow?.whatsapp_provider === 'meta_cloud') {
      console.log('[send-whatsapp-message] Routing via Meta WhatsApp Cloud for company', conversation.company_id);
      try {
        const cloudRes = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-whatsapp-cloud`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              company_id: conversation.company_id,
              to: conversation.phone,
              body: message || undefined,
              media_url: effectiveMediaUrl || undefined,
            }),
          }
        );
        const cloudJson = await cloudRes.json().catch(() => ({}));
        if (!cloudRes.ok) {
          console.error('[send-whatsapp-message] Cloud send failed:', cloudJson);
          return new Response(
            JSON.stringify({ error: cloudJson?.error || 'Cloud send failed', meta: cloudJson }),
            { status: cloudRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, provider: 'meta_cloud', message_id: cloudJson?.message_id }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        console.error('[send-whatsapp-message] Cloud delegation error:', e);
        return new Response(
          JSON.stringify({ error: 'Cloud delegation failed' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Send message via Twilio WhatsApp API (default)
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && conversation.companies?.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      
      const formData = new URLSearchParams();
      // Normalize From number
      const fromNumber = normalizeWhatsAppTo(conversation.companies.whatsapp_number);
      formData.append('From', fromNumber);

      // Normalize To number — ensure whatsapp: prefix
      const toNumber = normalizeWhatsAppTo(conversation.phone);
      formData.append('To', toNumber);
      
      formData.append('Body', message || '');
      
      if (effectiveMediaUrl) {
        console.log('Adding MediaUrl to Twilio request:', effectiveMediaUrl);
        formData.append('MediaUrl', effectiveMediaUrl);
      }

      console.log(`[send-whatsapp-message] Sending: From=${fromNumber} To=${toNumber}`);

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
          console.error('Twilio API error:', twilioResponse.status, errorText);
        } else {
          console.log('Message sent via Twilio successfully');
        }
      } catch (twilioError) {
        console.error('Error sending message via Twilio:', twilioError);
      }
    } else {
      console.warn('[send-whatsapp-message] Missing Twilio creds or whatsapp_number, skipping Twilio send');
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in send-whatsapp-message:", error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
