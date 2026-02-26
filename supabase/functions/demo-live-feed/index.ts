import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEMO_COMPANY_ID = "332b4f2c-9255-47f6-be9e-69e52ea22656";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Handle POST actions (resolve, etc.)
    if (req.method === "POST") {
      const body = await req.json();
      if (body.action === 'resolve' && body.queue_id) {
        // Get linked ticket/conversation before updating
        const { data: queueItem } = await supabase
          .from('agent_queue')
          .select('ticket_id, conversation_id')
          .eq('id', body.queue_id)
          .single();

        await supabase.from('agent_queue').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', body.queue_id);

        if (queueItem?.ticket_id) {
          await supabase.from('support_tickets').update({
            status: 'resolved',
            resolved_at: new Date().toISOString(),
          }).eq('id', queueItem.ticket_id);
        }
        if (queueItem?.conversation_id) {
          await supabase.from('conversations').update({
            is_paused_for_human: false,
            human_takeover: false,
          }).eq('id', queueItem.conversation_id);
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Handle agent reply — send WhatsApp message to customer
      if (body.action === 'send_reply' && body.customer_phone && body.message) {
        console.log("[demo-live-feed] send_reply to:", body.customer_phone, "message:", body.message.substring(0, 50));
        const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
        const twilioNumber = Deno.env.get("TWILIO_WHATSAPP_NUMBER") || "whatsapp:+13345083612";

        // Find the conversation for this customer
        const { data: conv } = await supabase
          .from('conversations')
          .select('id')
          .eq('company_id', DEMO_COMPANY_ID)
          .eq('phone', body.customer_phone)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Store the agent message in DB
        if (conv) {
          await supabase.from('messages').insert({
            conversation_id: conv.id,
            role: 'assistant',
            content: `[Agent] ${body.message}`,
          });
        }

        // Send via Twilio WhatsApp
        if (twilioSid && twilioAuth) {
          const toNumber = body.customer_phone.startsWith('whatsapp:')
            ? body.customer_phone
            : `whatsapp:${body.customer_phone}`;

          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append("To", toNumber);
          formData.append("From", twilioNumber);
          formData.append("Body", body.message);

          const twilioRes = await fetch(twilioUrl, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
          });

          if (!twilioRes.ok) {
            const err = await twilioRes.text();
            console.error("Twilio send error:", err);
          }
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Unknown POST action - return error
      console.log("[demo-live-feed] Unknown POST action:", body.action);
      return new Response(
        JSON.stringify({ error: "Unknown action: " + body.action }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET: return live feed data
    const { data: demoSession } = await supabase
      .from("demo_sessions")
      .select("*")
      .eq("company_id", DEMO_COMPANY_ID)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const sessionStart = demoSession?.created_at || new Date().toISOString();
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, customer_name, phone, status, active_agent, human_takeover, created_at, last_message_preview")
      .eq("company_id", DEMO_COMPANY_ID)
      .gte("created_at", sessionStart)
      .order("created_at", { ascending: false })
      .limit(10);

    const conversationIds = (conversations || []).map((c: any) => c.id);

    let messages: any[] = [];
    if (conversationIds.length > 0) {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(100);
      messages = data || [];
    }

    const { data: tickets } = await supabase
      .from("support_tickets")
      .select("id, ticket_number, customer_name, customer_phone, issue_summary, issue_category, priority, status, assigned_to, recommended_department, created_at")
      .eq("company_id", DEMO_COMPANY_ID)
      .gte("created_at", sessionStart)
      .order("created_at", { ascending: false })
      .limit(10);

    const { data: queue } = await supabase
      .from("agent_queue")
      .select("id, customer_name, customer_phone, priority, status, department, ai_summary, sla_deadline, claimed_at, created_at, conversation_id")
      .eq("company_id", DEMO_COMPANY_ID)
      .gte("created_at", sessionStart)
      .order("created_at", { ascending: false })
      .limit(10);

    const totalConversations = conversations?.length || 0;
    const activeConversations = conversations?.filter((c: any) => c.status === "active").length || 0;
    const handoffs = conversations?.filter((c: any) => c.human_takeover).length || 0;

    return new Response(
      JSON.stringify({
        demo_session: demoSession,
        conversations,
        messages: messages.reverse(),
        tickets: tickets || [],
        queue: queue || [],
        stats: {
          total_conversations: totalConversations,
          active_conversations: activeConversations,
          handoffs,
          tickets_created: tickets?.length || 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
