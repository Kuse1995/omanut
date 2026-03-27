import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Authenticate via x-api-key header
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing x-api-key header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const keyHash = await hashKey(apiKey);

    const { data: keyRecord, error: keyError } = await supabase
      .from("company_api_keys")
      .select("id, company_id, is_active, expires_at, scopes")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (keyError || !keyRecord) {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!keyRecord.is_active) {
      return new Response(
        JSON.stringify({ error: "API key has been revoked" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (
      keyRecord.expires_at &&
      new Date(keyRecord.expires_at) < new Date()
    ) {
      return new Response(JSON.stringify({ error: "API key has expired" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = keyRecord.company_id;

    // Update last_used_at (fire and forget)
    supabase
      .from("company_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRecord.id)
      .then(() => {});

    const { action, params } = await req.json();

    const respond = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ── ACTION ROUTER ──

    if (action === "get_company_info") {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .single();
      if (error) throw error;
      return respond({ company: data });
    }

    if (action === "send_message") {
      const { phone, message, media_url } = params || {};
      if (!phone || !message) {
        return respond({ error: "phone and message are required" }, 400);
      }

      // Call the existing send-whatsapp-message function
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-message`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          company_id: companyId,
          phone,
          message,
          media_url,
        }),
      });
      const result = await res.json();
      return respond(result, res.status);
    }

    if (action === "list_conversations") {
      const limit = params?.limit || 50;
      const status = params?.status;
      let query = supabase
        .from("conversations")
        .select(
          "id, phone, customer_name, status, started_at, last_message_preview, unread_count, active_agent"
        )
        .eq("company_id", companyId)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return respond({ conversations: data });
    }

    if (action === "get_conversation") {
      const { conversation_id } = params || {};
      if (!conversation_id) {
        return respond({ error: "conversation_id is required" }, 400);
      }

      // Verify conversation belongs to this company
      const { data: conv, error: convErr } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("company_id", companyId)
        .single();
      if (convErr) throw convErr;

      const { data: msgs, error: msgsErr } = await supabase
        .from("messages")
        .select("id, role, content, created_at, message_metadata")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: true });
      if (msgsErr) throw msgsErr;

      return respond({ conversation: conv, messages: msgs });
    }

    if (action === "list_reservations") {
      const limit = params?.limit || 50;
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("company_id", companyId)
        .order("date", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return respond({ reservations: data });
    }

    if (action === "create_reservation") {
      const { name, phone, date, time, guests, branch, area_preference, occasion, email } =
        params || {};
      if (!name || !phone || !date || !time || !guests) {
        return respond(
          { error: "name, phone, date, time, guests are required" },
          400
        );
      }
      const { data, error } = await supabase
        .from("reservations")
        .insert({
          company_id: companyId,
          name,
          phone,
          date,
          time,
          guests,
          branch: branch || "Main",
          area_preference,
          occasion,
          email,
          status: "pending_boss_approval",
        })
        .select()
        .single();
      if (error) throw error;
      return respond({ reservation: data });
    }

    if (action === "list_products") {
      const { data, error } = await supabase
        .from("payment_products")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true);
      if (error) throw error;
      return respond({ products: data });
    }

    if (action === "list_customers") {
      const limit = params?.limit || 100;
      const { data, error } = await supabase
        .from("customer_segments")
        .select("*")
        .eq("company_id", companyId)
        .order("last_interaction_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return respond({ customers: data });
    }

    if (action === "get_ai_config") {
      const { data, error } = await supabase
        .from("company_ai_overrides")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return respond({ ai_config: data });
    }

    if (action === "list_ai_errors") {
      const limit = params?.limit || 50;
      const severity = params?.severity;
      const errStatus = params?.status;
      let query = supabase
        .from("ai_error_logs")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (severity) query = query.eq("severity", severity);
      if (errStatus) query = query.eq("status", errStatus);
      const { data, error } = await query;
      if (error) throw error;
      return respond({ errors: data });
    }

    if (action === "get_conversation_messages") {
      const { conversation_id } = params || {};
      if (!conversation_id) {
        return respond({ error: "conversation_id is required" }, 400);
      }
      // Verify belongs to company
      const { error: accessErr } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversation_id)
        .eq("company_id", companyId)
        .single();
      if (accessErr) throw accessErr;

      const { data: msgs, error: msgsErr } = await supabase
        .from("messages")
        .select("id, role, content, created_at, message_metadata")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: true });
      if (msgsErr) throw msgsErr;
      return respond({ messages: msgs });
    }

    if (action === "search_knowledge_base") {
      const { query: searchQuery, limit: searchLimit } = params || {};
      if (!searchQuery) return respond({ error: "query is required" }, 400);
      const { data, error } = await supabase
        .from("company_documents")
        .select("id, filename, file_type, parsed_content, created_at")
        .eq("company_id", companyId)
        .ilike("parsed_content", `%${searchQuery}%`)
        .limit(searchLimit || 10);
      if (error) throw error;
      return respond({ documents: data });
    }

    if (action === "update_knowledge_base") {
      const { filename, content } = params || {};
      if (!filename || !content) return respond({ error: "filename and content are required" }, 400);
      const { data: existing } = await supabase
        .from("company_documents")
        .select("id")
        .eq("company_id", companyId)
        .eq("filename", filename)
        .maybeSingle();
      if (existing) {
        const { data, error } = await supabase
          .from("company_documents")
          .update({ parsed_content: content, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        return respond({ action: "updated", document: data });
      } else {
        const { data, error } = await supabase
          .from("company_documents")
          .insert({
            company_id: companyId,
            filename,
            file_path: `kb/${filename}`,
            file_type: "text/plain",
            file_size: new TextEncoder().encode(content).length,
            parsed_content: content,
          })
          .select()
          .single();
        if (error) throw error;
        return respond({ action: "created", document: data });
      }
    }

    if (action === "list_media") {
      const { data, error } = await supabase
        .from("company_media")
        .select("id, file_name, file_path, media_type, category, description, tags")
        .eq("company_id", companyId);
      if (error) throw error;
      return respond({ media: data });
    }

    if (action === "get_analytics") {
      const days = params?.days || 30;
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString();

      const [convRes, payRes, resRes] = await Promise.all([
        supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("started_at", sinceStr),
        supabase
          .from("payment_transactions")
          .select("amount")
          .eq("company_id", companyId)
          .eq("payment_status", "completed")
          .gte("created_at", sinceStr),
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("created_at", sinceStr),
      ]);

      const totalRevenue = (payRes.data || []).reduce(
        (sum: number, t: { amount: number }) => sum + Number(t.amount),
        0
      );

      return respond({
        analytics: {
          period_days: days,
          total_conversations: convRes.count || 0,
          total_reservations: resRes.count || 0,
          total_revenue: totalRevenue,
          completed_payments: (payRes.data || []).length,
        },
      });
    }

    // ── TICKET ACTIONS ──

    if (action === "list_tickets") {
      const limit = params?.limit || 50;
      const status = params?.status;
      const priority = params?.priority;
      let query = supabase
        .from("support_tickets")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status) query = query.eq("status", status);
      if (priority) query = query.eq("priority", priority);
      const { data, error } = await query;
      if (error) throw error;
      return respond({ tickets: data });
    }

    if (action === "create_ticket") {
      const { customer_name, customer_phone, issue_summary, issue_category, priority, recommended_department } = params || {};
      if (!customer_phone || !issue_summary) {
        return respond({ error: "customer_phone and issue_summary are required" }, 400);
      }
      const { data, error } = await supabase
        .from("support_tickets")
        .insert({
          company_id: companyId,
          ticket_number: '',
          customer_name: customer_name || null,
          customer_phone,
          issue_summary,
          issue_category: issue_category || 'general',
          priority: priority || 'medium',
          recommended_department: recommended_department || null,
          status: 'open',
        })
        .select()
        .single();
      if (error) throw error;
      return respond({ ticket: data });
    }

    if (action === "update_ticket") {
      const { ticket_id, status, assigned_to, resolution_notes, priority } = params || {};
      if (!ticket_id) {
        return respond({ error: "ticket_id is required" }, 400);
      }
      const updates: Record<string, any> = {};
      if (status) updates.status = status;
      if (assigned_to !== undefined) updates.assigned_to = assigned_to;
      if (resolution_notes !== undefined) updates.resolution_notes = resolution_notes;
      if (priority) updates.priority = priority;
      if (status === 'resolved') updates.resolved_at = new Date().toISOString();
      
      const { data, error } = await supabase
        .from("support_tickets")
        .update(updates)
        .eq("id", ticket_id)
        .eq("company_id", companyId)
        .select()
        .single();
      if (error) throw error;
      return respond({ ticket: data });
    }

    return respond(
      {
        error: `Unknown action: ${action}`,
        available_actions: [
          "get_company_info",
          "send_message",
          "list_conversations",
          "get_conversation",
          "list_reservations",
          "create_reservation",
          "list_products",
          "list_customers",
          "list_media",
          "get_analytics",
          "list_tickets",
          "create_ticket",
          "update_ticket",
        ],
      },
      400
    );
  } catch (err) {
    console.error("agent-api error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
