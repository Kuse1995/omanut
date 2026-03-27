import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function authenticateApiKey(req: Request, supabase: any): Promise<{ companyId: string } | Response> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing x-api-key header" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const keyHash = await hashKey(apiKey);
  const { data: keyRecord, error } = await supabase
    .from("company_api_keys")
    .select("id, company_id, is_active, expires_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error || !keyRecord) {
    return new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!keyRecord.is_active) {
    return new Response(JSON.stringify({ error: "API key revoked" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "API key expired" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // fire-and-forget last_used_at update
  supabase.from("company_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRecord.id).then(() => {});

  return { companyId: keyRecord.company_id };
}

function createMcpServer(supabase: any, companyId: string): McpServer {
  const server = new McpServer({ name: "omanut-ai", version: "1.0.0" });

  // ── list_conversations ──
  server.tool({
    name: "list_conversations",
    description: "List recent conversations with customers. Filter by status (active/ended).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 50)" },
        status: { type: "string", description: "Filter by status: active, ended" },
      },
    },
    handler: async (params: any) => {
      const limit = params?.limit || 50;
      let query = supabase
        .from("conversations")
        .select("id, phone, customer_name, status, started_at, last_message_preview, unread_count, active_agent")
        .eq("company_id", companyId)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (params?.status) query = query.eq("status", params.status);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ conversations: data }, null, 2) }] };
    },
  });

  // ── get_conversation ──
  server.tool({
    name: "get_conversation",
    description: "Get full conversation details and all messages for analysis.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "UUID of the conversation" },
      },
      required: ["conversation_id"],
    },
    handler: async (params: any) => {
      const { data: conv, error: convErr } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", params.conversation_id)
        .eq("company_id", companyId)
        .single();
      if (convErr) throw convErr;
      const { data: msgs, error: msgsErr } = await supabase
        .from("messages")
        .select("id, role, content, created_at, message_metadata")
        .eq("conversation_id", params.conversation_id)
        .order("created_at", { ascending: true });
      if (msgsErr) throw msgsErr;
      return { content: [{ type: "text", text: JSON.stringify({ conversation: conv, messages: msgs }, null, 2) }] };
    },
  });

  // ── get_analytics ──
  server.tool({
    name: "get_analytics",
    description: "Get business analytics: conversation count, revenue, reservations over a period.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Period in days (default 30)" },
      },
    },
    handler: async (params: any) => {
      const days = params?.days || 30;
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString();
      const [convRes, payRes, resRes] = await Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("started_at", sinceStr),
        supabase.from("payment_transactions").select("amount").eq("company_id", companyId).eq("payment_status", "completed").gte("created_at", sinceStr),
        supabase.from("reservations").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("created_at", sinceStr),
      ]);
      const totalRevenue = (payRes.data || []).reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      return {
        content: [{ type: "text", text: JSON.stringify({
          period_days: days,
          total_conversations: convRes.count || 0,
          total_reservations: resRes.count || 0,
          total_revenue: totalRevenue,
          completed_payments: (payRes.data || []).length,
        }, null, 2) }],
      };
    },
  });

  // ── list_customers ──
  server.tool({
    name: "list_customers",
    description: "List customer segments with engagement scores, interests, and conversion potential.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max results (default 100)" } },
    },
    handler: async (params: any) => {
      const { data, error } = await supabase
        .from("customer_segments")
        .select("*")
        .eq("company_id", companyId)
        .order("last_interaction_at", { ascending: false })
        .limit(params?.limit || 100);
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ customers: data }, null, 2) }] };
    },
  });

  // ── list_tickets ──
  server.tool({
    name: "list_tickets",
    description: "List support tickets. Filter by status or priority.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        status: { type: "string" },
        priority: { type: "string" },
      },
    },
    handler: async (params: any) => {
      let query = supabase.from("support_tickets").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(params?.limit || 50);
      if (params?.status) query = query.eq("status", params.status);
      if (params?.priority) query = query.eq("priority", params.priority);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ tickets: data }, null, 2) }] };
    },
  });

  // ── create_ticket ──
  server.tool({
    name: "create_ticket",
    description: "Create a support ticket for tracking an issue.",
    inputSchema: {
      type: "object",
      properties: {
        customer_phone: { type: "string" },
        customer_name: { type: "string" },
        issue_summary: { type: "string" },
        issue_category: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      },
      required: ["customer_phone", "issue_summary"],
    },
    handler: async (params: any) => {
      const { data, error } = await supabase.from("support_tickets").insert({
        company_id: companyId,
        ticket_number: "",
        customer_phone: params.customer_phone,
        customer_name: params.customer_name || null,
        issue_summary: params.issue_summary,
        issue_category: params.issue_category || "general",
        priority: params.priority || "medium",
        status: "open",
      }).select().single();
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ ticket: data }, null, 2) }] };
    },
  });

  // ── send_message ──
  server.tool({
    name: "send_message",
    description: "Send a WhatsApp message to a customer.",
    inputSchema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Customer phone number" },
        message: { type: "string", description: "Message text" },
        media_url: { type: "string", description: "Optional media URL" },
      },
      required: ["phone", "message"],
    },
    handler: async (params: any) => {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-message`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ company_id: companyId, phone: params.phone, message: params.message, media_url: params.media_url }),
      });
      const result = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  // ── get_ai_config ──
  server.tool({
    name: "get_ai_config",
    description: "Get AI configuration and overrides: model, temperature, system prompt, tools, supervisor settings.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data, error } = await supabase
        .from("company_ai_overrides")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ ai_config: data }, null, 2) }] };
    },
  });

  // ── list_ai_errors ──
  server.tool({
    name: "list_ai_errors",
    description: "List AI error logs to identify quality issues, hallucinations, and misroutes.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 50)" },
        severity: { type: "string", description: "Filter: low, medium, high, critical" },
        status: { type: "string", description: "Filter: new, reviewed, fixed" },
      },
    },
    handler: async (params: any) => {
      let query = supabase
        .from("ai_error_logs")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(params?.limit || 50);
      if (params?.severity) query = query.eq("severity", params.severity);
      if (params?.status) query = query.eq("status", params.status);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ errors: data }, null, 2) }] };
    },
  });

  // ── list_media ──
  server.tool({
    name: "list_media",
    description: "List company media assets (images, videos, documents).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data, error } = await supabase
        .from("company_media")
        .select("id, file_name, file_path, media_type, category, description, tags")
        .eq("company_id", companyId);
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ media: data }, null, 2) }] };
    },
  });

  // ── list_reservations ──
  server.tool({
    name: "list_reservations",
    description: "List reservations/bookings.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    handler: async (params: any) => {
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("company_id", companyId)
        .order("date", { ascending: false })
        .limit(params?.limit || 50);
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ reservations: data }, null, 2) }] };
    },
  });

  // ── list_products ──
  server.tool({
    name: "list_products",
    description: "List active payment products.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data, error } = await supabase
        .from("payment_products")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true);
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ products: data }, null, 2) }] };
    },
  });

  // ── get_company_info ──
  server.tool({
    name: "get_company_info",
    description: "Get company profile and settings.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data, error } = await supabase.from("companies").select("*").eq("id", companyId).single();
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ company: data }, null, 2) }] };
    },
  });

  // ── search_knowledge_base ──
  server.tool({
    name: "search_knowledge_base",
    description: "Search company documents by keyword in parsed content.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    handler: async (params: any) => {
      const { data, error } = await supabase
        .from("company_documents")
        .select("id, filename, file_type, parsed_content, created_at")
        .eq("company_id", companyId)
        .ilike("parsed_content", `%${params.query}%`)
        .limit(params?.limit || 10);
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify({ documents: data }, null, 2) }] };
    },
  });

  // ── update_knowledge_base ──
  server.tool({
    name: "update_knowledge_base",
    description: "Add or update a knowledge base document. Provide filename and content to upsert.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Document filename (used as key)" },
        content: { type: "string", description: "Document text content" },
      },
      required: ["filename", "content"],
    },
    handler: async (params: any) => {
      // Check if doc exists
      const { data: existing } = await supabase
        .from("company_documents")
        .select("id")
        .eq("company_id", companyId)
        .eq("filename", params.filename)
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabase
          .from("company_documents")
          .update({ parsed_content: params.content, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        return { content: [{ type: "text", text: JSON.stringify({ action: "updated", document: data }, null, 2) }] };
      } else {
        const { data, error } = await supabase
          .from("company_documents")
          .insert({
            company_id: companyId,
            filename: params.filename,
            file_path: `kb/${params.filename}`,
            file_type: "text/plain",
            file_size: new TextEncoder().encode(params.content).length,
            parsed_content: params.content,
          })
          .select()
          .single();
        if (error) throw error;
        return { content: [{ type: "text", text: JSON.stringify({ action: "created", document: data }, null, 2) }] };
      }
    },
  });

  return server;
}

const app = new Hono();

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  await next();
  // Add CORS headers to all responses
  Object.entries(corsHeaders).forEach(([k, v]) => c.res.headers.set(k, v));
});

app.all("/*", async (c) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authResult = await authenticateApiKey(c.req.raw, supabase);
  if (authResult instanceof Response) return authResult;

  const mcpServer = createMcpServer(supabase, authResult.companyId);
  const transport = new StreamableHttpTransport();
  return await transport.handleRequest(c.req.raw, mcpServer);
});

Deno.serve(app.fetch);
