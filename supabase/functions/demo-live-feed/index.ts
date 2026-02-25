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

    // Get active demo session
    const { data: demoSession } = await supabase
      .from("demo_sessions")
      .select("*")
      .eq("company_id", DEMO_COMPANY_ID)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get recent conversations (only from current demo session)
    const sessionStart = demoSession?.created_at || new Date().toISOString();
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, customer_name, phone, status, active_agent, human_takeover, created_at, last_message_preview")
      .eq("company_id", DEMO_COMPANY_ID)
      .gte("created_at", sessionStart)
      .order("created_at", { ascending: false })
      .limit(10);

    const conversationIds = (conversations || []).map((c: any) => c.id);

    // Get recent messages across demo conversations
    let messages: any[] = [];
    if (conversationIds.length > 0) {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(30);
      messages = data || [];
    }

    // Get support tickets
    const { data: tickets } = await supabase
      .from("support_tickets")
      .select("id, ticket_number, customer_name, customer_phone, issue_summary, issue_category, priority, status, assigned_to, recommended_department, created_at")
      .eq("company_id", DEMO_COMPANY_ID)
      .gte("created_at", sessionStart)
      .order("created_at", { ascending: false })
      .limit(10);

    // Get agent queue
    const { data: queue } = await supabase
      .from("agent_queue")
      .select("id, customer_name, customer_phone, priority, status, department, ai_summary, sla_deadline, claimed_at, created_at")
      .eq("company_id", DEMO_COMPANY_ID)
      .gte("created_at", sessionStart)
      .order("created_at", { ascending: false })
      .limit(10);

    // Stats
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
