import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

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

type AuthContext = {
  keyId: string;
  keyPrefix: string;
  keyName: string | null;
  scope: "company" | "admin";
  defaultCompanyId: string | null; // null for admin scope
  createdBy: string;
};

// Persistent session store backed by public.mcp_active_company table.
// Survives edge function cold starts. Keyed by (api_key_id, session_id).
async function getActiveCompany(supabase: any, keyId: string, sessionId: string): Promise<string | null> {
  const { data } = await supabase
    .from("mcp_active_company")
    .select("company_id")
    .eq("api_key_id", keyId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (data?.company_id) return data.company_id;
  // Fallback: any recent session for this key (handles mcp-remote rotating session ids)
  const { data: fallback } = await supabase
    .from("mcp_active_company")
    .select("company_id")
    .eq("api_key_id", keyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return fallback?.company_id || null;
}

async function setActiveCompany(supabase: any, keyId: string, sessionId: string, companyId: string): Promise<void> {
  await supabase
    .from("mcp_active_company")
    .upsert({ api_key_id: keyId, session_id: sessionId, company_id: companyId, updated_at: new Date().toISOString() }, { onConflict: "api_key_id,session_id" });
}

async function authenticateApiKey(req: Request, supabase: any): Promise<AuthContext | Response> {
  const rawApiKey = req.headers.get("x-api-key");
  if (!rawApiKey) {
    return new Response(JSON.stringify({ error: "Missing x-api-key header" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = rawApiKey.trim();
  const keyPrefix = apiKey.substring(0, 12);
  const keyHash = await hashKey(apiKey);

  console.log(`[MCP-AUTH] Key prefix: ${keyPrefix}, computed hash: ${keyHash.substring(0, 16)}...`);

  const { data: keyRecord, error } = await supabase
    .from("company_api_keys")
    .select("id, company_id, is_active, expires_at, scope, created_by, name, key_prefix")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error) console.error("[MCP-AUTH] DB query error:", error.message);

  if (!keyRecord) {
    console.warn(`[MCP-AUTH] No key found for prefix ${keyPrefix}`);
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

  const scope = (keyRecord.scope || "company") as "company" | "admin";

  // Re-validate admin role on every request for admin-scoped keys
  if (scope === "admin") {
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", keyRecord.created_by)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      console.warn(`[MCP-AUTH] Admin key ${keyPrefix}: creator no longer has admin role`);
      return new Response(JSON.stringify({ error: "API key disabled: creator no longer has admin role" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  console.log(`[MCP-AUTH] Authenticated key ${keyPrefix} scope=${scope} default_company=${keyRecord.company_id || "<admin>"}`);
  supabase.from("company_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRecord.id).then(() => {});

  return {
    keyId: keyRecord.id,
    keyPrefix: keyRecord.key_prefix || keyPrefix,
    keyName: keyRecord.name || null,
    scope,
    defaultCompanyId: keyRecord.company_id,
    createdBy: keyRecord.created_by,
  };
}

function createMcpServer(supabase: any, auth: AuthContext, sessionId: string): McpServer {
  const server = new McpServer({
    name: "omanut-ai",
    version: "1.1.0",
    schemaAdapter: (schema: unknown) => zodToJsonSchema(schema as z.ZodType, { target: "openApi3" }),
  });

  // Resolve which company this tool call should target.
  // Priority: per-call company_id > session-active (admin only) > key default.
  // For company-scoped keys, the per-call arg is ignored to preserve tenant isolation.
  function resolveCompanyId(perCallCompanyId?: string): string {
    if (auth.scope === "company") {
      // Company keys are pinned — ignore any client override.
      if (!auth.defaultCompanyId) {
        throw new Error("Company-scoped key has no company_id (configuration error)");
      }
      return auth.defaultCompanyId;
    }
    // Admin scope
    const explicit = perCallCompanyId?.trim();
    if (explicit) return explicit;
    const active = adminSessionActiveCompany.get(sessionId);
    if (active) return active;
    throw new Error("No active company set. Call list_my_companies, then set_active_company first, or pass company_id in this tool call.");
  }

  // Verify admin caller actually has access to this company (admin role grants access to all)
  // Currently admin role implies access to everything — simple gate. If you later want
  // restricted admin keys, scope this further.
  async function requireCompanyAccess(companyId: string): Promise<void> {
    if (auth.scope === "company") return; // already pinned
    // Admin role = access to all companies. Validate company exists.
    const { data: c } = await supabase.from("companies").select("id").eq("id", companyId).maybeSingle();
    if (!c) throw new Error(`Company not found: ${companyId}`);
  }

  // ═══════════════════════════════════════════════════════════
  // SESSION / COMPANY-SWITCHING TOOLS (admin keys only useful here)
  // ═══════════════════════════════════════════════════════════

  server.tool("who_am_i", {
    description: "Debug: report which API key is currently authenticated, its scope, and the active company. ALWAYS call this first when setting up the connection — verify the key prefix matches the key you intended to install before running any other tools.",
    inputSchema: z.object({}),
    handler: async () => {
      const active = adminSessionActiveCompany.get(sessionId) || null;
      let activeName: string | null = null;
      if (active) {
        const { data } = await supabase.from("companies").select("name").eq("id", active).maybeSingle();
        activeName = data?.name || null;
      }
      let defaultName: string | null = null;
      if (auth.defaultCompanyId) {
        const { data } = await supabase.from("companies").select("name").eq("id", auth.defaultCompanyId).maybeSingle();
        defaultName = data?.name || null;
      }
      let companyCount: number | null = null;
      if (auth.scope === "admin") {
        const { count } = await supabase.from("companies").select("id", { count: "exact", head: true });
        companyCount = count || 0;
      } else {
        companyCount = 1;
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({
        key_prefix: auth.keyPrefix,
        key_name: auth.keyName,
        scope: auth.scope,
        default_company_id: auth.defaultCompanyId,
        default_company_name: defaultName,
        active_company_id: active,
        active_company_name: activeName,
        visible_company_count: companyCount,
        session_id: sessionId,
        server_version: "1.1.0",
      }, null, 2) }] };
    },
  });

  server.tool("list_my_companies", {
    description: "List all companies you can train. For admin keys this returns every company; for company keys it returns only the pinned company. Use this first, then call set_active_company.",
    inputSchema: z.object({}),
    handler: async () => {
      if (auth.scope === "company") {
        const { data } = await supabase.from("companies").select("id, name, business_type").eq("id", auth.defaultCompanyId).maybeSingle();
        return { content: [{ type: "text" as const, text: JSON.stringify({
          key_prefix: auth.keyPrefix,
          scope: "company",
          default_company_id: auth.defaultCompanyId,
          active_company_id: auth.defaultCompanyId,
          company_count: data ? 1 : 0,
          companies: data ? [data] : [],
        }, null, 2) }] };
      }
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, business_type, created_at")
        .order("name", { ascending: true });
      if (error) throw error;
      const active = adminSessionActiveCompany.get(sessionId) || null;
      return { content: [{ type: "text" as const, text: JSON.stringify({
        key_prefix: auth.keyPrefix,
        scope: "admin",
        default_company_id: null,
        active_company_id: active,
        company_count: data?.length || 0,
        companies: data,
      }, null, 2) }] };
    },
  });

  server.tool("set_active_company", {
    description: "Set the active company for the rest of this session. After calling this, all subsequent tool calls (without an explicit company_id) target this company. Only meaningful for admin-scoped keys.",
    inputSchema: z.object({
      company_id: z.string().describe("UUID of the company to switch to"),
    }),
    handler: async (params: any) => {
      if (auth.scope === "company") {
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, note: "Company-scoped key is already pinned; switching is a no-op.", active_company_id: auth.defaultCompanyId }, null, 2) }] };
      }
      await requireCompanyAccess(params.company_id);
      adminSessionActiveCompany.set(sessionId, params.company_id);
      const { data: c } = await supabase.from("companies").select("id, name").eq("id", params.company_id).maybeSingle();
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, active_company_id: params.company_id, company_name: c?.name || null, message: `All subsequent tool calls will target ${c?.name || params.company_id}.` }, null, 2) }] };
    },
  });

  // Helper for tool schemas: optional per-call company_id override
  const companyOverride = z.object({ company_id: z.string().optional().describe("Optional: target a specific company (admin keys only). If omitted, uses set_active_company or the key's default.") });

  // ── list_conversations ──
  server.tool("list_conversations", {
    description: "List recent conversations with customers. Filter by status (active/ended).",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results (default 50)"),
      status: z.string().optional().describe("Filter by status: active, ended"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
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
      return { content: [{ type: "text" as const, text: JSON.stringify({ company_id: companyId, conversations: data }, null, 2) }] };
    },
  });

  // ── get_conversation ──
  server.tool("get_conversation", {
    description: "Get full conversation details and all messages for analysis.",
    inputSchema: z.object({
      conversation_id: z.string().describe("UUID of the conversation"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
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
      return { content: [{ type: "text" as const, text: JSON.stringify({ conversation: conv, messages: msgs }, null, 2) }] };
    },
  });

  // ── get_analytics ──
  server.tool("get_analytics", {
    description: "Get business analytics: conversation count, revenue, reservations over a period.",
    inputSchema: z.object({
      days: z.number().optional().describe("Period in days (default 30)"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
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
        content: [{ type: "text" as const, text: JSON.stringify({
          company_id: companyId,
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
  server.tool("list_customers", {
    description: "List customer segments with engagement scores, interests, and conversion potential.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results (default 100)"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("customer_segments")
        .select("*")
        .eq("company_id", companyId)
        .order("last_interaction_at", { ascending: false })
        .limit(params?.limit || 100);
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ customers: data }, null, 2) }] };
    },
  });

  // ── list_tickets ──
  server.tool("list_tickets", {
    description: "List support tickets. Filter by status or priority.",
    inputSchema: z.object({
      limit: z.number().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      let query = supabase.from("support_tickets").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(params?.limit || 50);
      if (params?.status) query = query.eq("status", params.status);
      if (params?.priority) query = query.eq("priority", params.priority);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ tickets: data }, null, 2) }] };
    },
  });

  // ── create_ticket ──
  server.tool("create_ticket", {
    description: "Create a support ticket for tracking an issue.",
    inputSchema: z.object({
      customer_phone: z.string(),
      customer_name: z.string().optional(),
      issue_summary: z.string(),
      issue_category: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
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
      return { content: [{ type: "text" as const, text: JSON.stringify({ ticket: data }, null, 2) }] };
    },
  });

  // ── send_message ──
  server.tool("send_message", {
    description: "Send a WhatsApp message to a customer. Provide either conversation_id (preferred) or phone number.",
    inputSchema: z.object({
      phone: z.string().optional().describe("Customer phone number (used if conversation_id not provided)"),
      conversation_id: z.string().optional().describe("Conversation ID to send message to (preferred)"),
      message: z.string().describe("Message text"),
      media_url: z.string().optional().describe("Optional media URL"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-message`;
      const body: any = { company_id: companyId, message: params.message, media_url: params.media_url };
      if (params.conversation_id) body.conversationId = params.conversation_id;
      if (params.phone) body.phone = params.phone;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  // ── get_ai_config ──
  server.tool("get_ai_config", {
    description: "Get AI configuration and overrides: model, temperature, system prompt, tools, supervisor settings.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("company_ai_overrides")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ company_id: companyId, ai_config: data }, null, 2) }] };
    },
  });

  // ── list_ai_errors ──
  server.tool("list_ai_errors", {
    description: "List AI error logs to identify quality issues, hallucinations, and misroutes.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results (default 50)"),
      severity: z.string().optional().describe("Filter: low, medium, high, critical"),
      status: z.string().optional().describe("Filter: new, reviewed, fixed"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
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
      return { content: [{ type: "text" as const, text: JSON.stringify({ errors: data }, null, 2) }] };
    },
  });

  // ── list_media ──
  server.tool("list_media", {
    description: "List company media assets (images, videos, documents).",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("company_media")
        .select("id, file_name, file_path, media_type, category, description, tags")
        .eq("company_id", companyId);
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ media: data }, null, 2) }] };
    },
  });

  // ── list_reservations ──
  server.tool("list_reservations", {
    description: "List reservations/bookings.",
    inputSchema: z.object({
      limit: z.number().optional(),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("company_id", companyId)
        .order("date", { ascending: false })
        .limit(params?.limit || 50);
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ reservations: data }, null, 2) }] };
    },
  });

  // ── list_products ──
  server.tool("list_products", {
    description: "List active payment products.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("payment_products")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true);
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ products: data }, null, 2) }] };
    },
  });

  // ── get_company_info ──
  server.tool("get_company_info", {
    description: "Get company profile and settings.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase.from("companies").select("*").eq("id", companyId).single();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ company: data }, null, 2) }] };
    },
  });

  // ── search_knowledge_base ──
  server.tool("search_knowledge_base", {
    description: "Search company documents by keyword in parsed content.",
    inputSchema: z.object({
      query: z.string().describe("Search keyword"),
      limit: z.number().optional(),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("company_documents")
        .select("id, filename, file_type, parsed_content, created_at")
        .eq("company_id", companyId)
        .ilike("parsed_content", `%${params.query}%`)
        .limit(params?.limit || 10);
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ documents: data }, null, 2) }] };
    },
  });

  // ── update_knowledge_base ──
  server.tool("update_knowledge_base", {
    description: "Add or update a knowledge base document. Provide filename and content to upsert.",
    inputSchema: z.object({
      filename: z.string().describe("Document filename (used as key)"),
      content: z.string().describe("Document text content"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
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
        return { content: [{ type: "text" as const, text: JSON.stringify({ action: "updated", document: data }, null, 2) }] };
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
        return { content: [{ type: "text" as const, text: JSON.stringify({ action: "created", document: data }, null, 2) }] };
      }
    },
  });

  // ── list_scheduled_posts ──
  server.tool("list_scheduled_posts", {
    description: "List scheduled social media posts. Filter by status: pending_approval, approved, published, failed.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results (default 50)"),
      status: z.string().optional().describe("Filter: pending_approval, approved, published, failed"),
      platform: z.string().optional().describe("Filter: facebook, instagram, both"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      let query = supabase
        .from("scheduled_posts")
        .select("*")
        .eq("company_id", companyId)
        .order("scheduled_time", { ascending: false })
        .limit(params?.limit || 50);
      if (params?.status) query = query.eq("status", params.status);
      if (params?.platform) query = query.eq("platform", params.platform);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ scheduled_posts: data }, null, 2) }] };
    },
  });

  // ── review_scheduled_post ──
  server.tool("review_scheduled_post", {
    description: "Approve, reject, or edit a scheduled post. Use to act as a content approval agent.",
    inputSchema: z.object({
      post_id: z.string().describe("UUID of the scheduled post"),
      action: z.enum(["approve", "reject"]).describe("Approve or reject"),
      updated_caption: z.string().optional().describe("Optional: new caption text"),
      rejection_reason: z.string().optional().describe("Reason for rejection (if rejecting)"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const updates: any = {
        status: params.action === "approve" ? "approved" : "rejected",
        updated_at: new Date().toISOString(),
      };
      if (params.updated_caption) updates.content = params.updated_caption;
      if (params.rejection_reason) updates.rejection_reason = params.rejection_reason;
      const { data, error } = await supabase
        .from("scheduled_posts")
        .update(updates)
        .eq("id", params.post_id)
        .eq("company_id", companyId)
        .select()
        .single();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ action: params.action, post: data }, null, 2) }] };
    },
  });

  // ── create_scheduled_post ──
  server.tool("create_scheduled_post", {
    description: "Create a new scheduled social media post with caption, image, platform, and timing.",
    inputSchema: z.object({
      caption: z.string().describe("Post caption text"),
      image_url: z.string().optional().describe("Image URL for the post"),
      video_url: z.string().optional().describe("Video URL for the post (reels)"),
      platform: z.enum(["facebook", "instagram", "both"]).describe("Target platform"),
      scheduled_time: z.string().describe("ISO 8601 datetime for publishing"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data: cred } = await supabase
        .from("meta_credentials")
        .select("page_id")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();

      if (!cred?.page_id) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          error: "No Meta credentials configured. Add a Facebook Page in Meta Integrations first."
        }) }] };
      }

      const { data, error } = await supabase
        .from("scheduled_posts")
        .insert({
          company_id: companyId,
          page_id: cred.page_id,
          content: params.caption,
          image_url: params.image_url || null,
          video_url: params.video_url || null,
          target_platform: params.platform,
          scheduled_time: params.scheduled_time,
          status: "pending_approval",
          created_by: "00000000-0000-0000-0000-000000000000",
        })
        .select()
        .single();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ action: "created", post: data }, null, 2) }] };
    },
  });

  // ── list_generated_images ──
  server.tool("list_generated_images", {
    description: "List AI-generated images with prompts, approval status, brand assets used, and URLs.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results (default 50)"),
      status: z.string().optional().describe("Filter: draft, approved, rejected"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      let query = supabase
        .from("generated_images")
        .select("id, prompt, image_url, status, brand_assets_used, generation_params, created_at, approved_at, rejected_at, rejection_reason")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(params?.limit || 50);
      if (params?.status) query = query.eq("status", params.status);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ generated_images: data }, null, 2) }] };
    },
  });

  // ── get_image_generation_settings ──
  server.tool("get_image_generation_settings", {
    description: "Read the company's image generation config: style, tone, brand colors, visual guidelines, best posting times.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("image_generation_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ image_settings: data }, null, 2) }] };
    },
  });

  // ── update_image_generation_settings ──
  server.tool("update_image_generation_settings", {
    description: "Update image generation settings: style description, brand tone, visual guidelines, brand colors.",
    inputSchema: z.object({
      style_description: z.string().optional().describe("Visual style description"),
      brand_tone: z.string().optional().describe("Brand tone of voice"),
      visual_guidelines: z.string().optional().describe("Visual guidelines text"),
      brand_colors: z.string().optional().describe("Brand color palette description"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const updates: any = {};
      if (params.style_description) updates.style_description = params.style_description;
      if (params.brand_tone) updates.brand_tone = params.brand_tone;
      if (params.visual_guidelines) updates.visual_guidelines = params.visual_guidelines;
      if (params.brand_colors) updates.brand_colors = params.brand_colors;
      const { data, error } = await supabase
        .from("image_generation_settings")
        .update(updates)
        .eq("company_id", companyId)
        .select()
        .single();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ action: "updated", settings: data }, null, 2) }] };
    },
  });

  // ── list_product_identity_profiles ──
  server.tool("list_product_identity_profiles", {
    description: "List all product identity fingerprints: hex colors, labels, packaging shapes, exclusion keywords.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("product_identity_profiles")
        .select("*")
        .eq("company_id", companyId);
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ profiles: data }, null, 2) }] };
    },
  });

  // ── update_product_identity_profile ──
  server.tool("update_product_identity_profile", {
    description: "Edit a product identity profile: exclusion keywords, visual fingerprints, brand colors.",
    inputSchema: z.object({
      profile_id: z.string().describe("UUID of the profile to update"),
      exclusion_keywords: z.array(z.string()).optional().describe("Keywords to exclude from generation"),
      hex_colors: z.array(z.string()).optional().describe("Brand hex colors"),
      verbatim_labels: z.array(z.string()).optional().describe("Verbatim text labels on packaging"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const updates: any = {};
      if (params.exclusion_keywords) updates.exclusion_keywords = params.exclusion_keywords;
      if (params.hex_colors) updates.hex_colors = params.hex_colors;
      if (params.verbatim_labels) updates.verbatim_labels = params.verbatim_labels;
      const { data, error } = await supabase
        .from("product_identity_profiles")
        .update(updates)
        .eq("id", params.profile_id)
        .eq("company_id", companyId)
        .select()
        .single();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ action: "updated", profile: data }, null, 2) }] };
    },
  });

  // ── list_video_jobs ──
  server.tool("list_video_jobs", {
    description: "List video generation jobs with status, provider, aspect ratio, prompt, and result URL.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results (default 30)"),
      status: z.string().optional().describe("Filter: pending, processing, completed, failed"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      let query = supabase
        .from("video_generation_jobs")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(params?.limit || 30);
      if (params?.status) query = query.eq("status", params.status);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ video_jobs: data }, null, 2) }] };
    },
  });

  // ═══════════════════════════════════════════════════════════
  // BMS PROXY TOOLS — route through bms-agent edge function
  // ═══════════════════════════════════════════════════════════

  async function callBmsViaEdge(intent: string, companyId: string, params: Record<string, any> = {}) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bms-agent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ action: intent, params: { company_id: companyId, ...params } }),
    });
    return await res.json();
  }

  async function callEdgeFunction(fnName: string, body: Record<string, any>) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fnName}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify(body),
    });
    return await res.json();
  }

  // BMS tools
  const bmsToolDefs: Array<{ name: string; intent: string; description: string; schema: z.ZodObject<any> }> = [
    { name: "bms_check_stock", intent: "check_stock", description: "Check product stock levels in the BMS.", schema: z.object({ product_name: z.string().optional() }) },
    { name: "bms_record_sale", intent: "record_sale", description: "Record a completed sale transaction in the BMS.", schema: z.object({ product_name: z.string(), quantity: z.number(), customer_phone: z.string().optional(), amount: z.number().optional() }) },
    { name: "bms_create_invoice", intent: "create_invoice", description: "Generate an invoice for a customer.", schema: z.object({ customer_name: z.string(), customer_phone: z.string().optional(), items: z.array(z.any()) }) },
    { name: "bms_send_receipt", intent: "send_receipt", description: "Send a receipt to a customer.", schema: z.object({ customer_phone: z.string(), transaction_id: z.string().optional() }) },
    { name: "bms_generate_payment_link", intent: "generate_payment_link", description: "Create a Lenco payment link for checkout.", schema: z.object({ amount: z.number(), description: z.string(), customer_phone: z.string().optional() }) },
    { name: "bms_get_sales_summary", intent: "get_sales_summary", description: "Get revenue and sales summary report from BMS.", schema: z.object({ period: z.string().optional().describe("today, week, month") }) },
    { name: "bms_list_products", intent: "list_products", description: "List all products from the BMS catalog.", schema: z.object({ category: z.string().optional() }) },
    { name: "bms_low_stock_alerts", intent: "low_stock_alerts", description: "Get items below reorder threshold.", schema: z.object({}) },
    { name: "bms_who_owes", intent: "who_owes", description: "Get outstanding customer debts.", schema: z.object({}) },
    { name: "bms_profit_loss_report", intent: "profit_loss_report", description: "Get profit and loss financial report.", schema: z.object({ period: z.string().optional() }) },
    { name: "bms_create_order", intent: "create_order", description: "Create a new order in the BMS.", schema: z.object({ customer_name: z.string(), customer_phone: z.string().optional(), items: z.array(z.any()) }) },
    { name: "bms_get_order_status", intent: "get_order_status", description: "Track order fulfillment status.", schema: z.object({ order_id: z.string() }) },
  ];

  for (const tool of bmsToolDefs) {
    server.tool(tool.name, {
      description: tool.description,
      inputSchema: tool.schema.merge(companyOverride),
      handler: async (params: any) => {
        const companyId = resolveCompanyId(params?.company_id);
        const { company_id: _ignored, ...bmsParams } = params || {};
        const result = await callBmsViaEdge(tool.intent, companyId, bmsParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // META PLATFORM OUTBOUND TOOLS
  // ═══════════════════════════════════════════════════════════

  server.tool("send_facebook_message", {
    description: "Send a Facebook Messenger DM to a customer via their conversation.",
    inputSchema: z.object({
      conversation_id: z.string().describe("Conversation UUID (must be a Messenger conversation)"),
      text: z.string().describe("Message text"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      resolveCompanyId(params?.company_id); // gate
      const result = await callEdgeFunction("send-meta-dm", { conversationId: params.conversation_id, text: params.text });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  server.tool("send_instagram_message", {
    description: "Send an Instagram DM to a customer via their conversation.",
    inputSchema: z.object({
      conversation_id: z.string().describe("Conversation UUID (must be an IG DM conversation)"),
      text: z.string().describe("Message text"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      resolveCompanyId(params?.company_id);
      const result = await callEdgeFunction("send-meta-dm", { conversationId: params.conversation_id, text: params.text });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  server.tool("reply_facebook_comment", {
    description: "Reply to a Facebook or Instagram comment on a post.",
    inputSchema: z.object({
      comment_id: z.string().describe("The Meta comment ID to reply to"),
      message: z.string().describe("Reply text"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const result = await callEdgeFunction("send-facebook-comment-reply", {
        comment_id: params.comment_id,
        message: params.message,
        company_id: companyId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  server.tool("publish_facebook_post", {
    description: "Publish a post immediately to the company's Facebook Page.",
    inputSchema: z.object({
      caption: z.string().describe("Post caption/text"),
      image_url: z.string().optional().describe("Image URL to attach"),
      video_url: z.string().optional().describe("Video URL to attach"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const result = await callEdgeFunction("publish-meta-post", {
        company_id: companyId,
        platform: "facebook",
        caption: params.caption,
        image_url: params.image_url || null,
        video_url: params.video_url || null,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  server.tool("publish_instagram_post", {
    description: "Publish a post immediately to the company's Instagram Business account.",
    inputSchema: z.object({
      caption: z.string().describe("Post caption/text"),
      image_url: z.string().describe("Image URL (required for IG)"),
      video_url: z.string().optional().describe("Video URL for Reels"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const result = await callEdgeFunction("publish-meta-post", {
        company_id: companyId,
        platform: "instagram",
        caption: params.caption,
        image_url: params.image_url,
        video_url: params.video_url || null,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  // ═══════════════════════════════════════════════════════════
  // OPERATIONAL CONTROL TOOLS
  // ═══════════════════════════════════════════════════════════

  server.tool("update_ai_config", {
    description: "Update AI configuration: model, temperature, system prompt, enabled tools, response style.",
    inputSchema: z.object({
      primary_model: z.string().optional(),
      primary_temperature: z.number().optional(),
      system_instructions: z.string().optional(),
      enabled_tools: z.array(z.string()).optional(),
      response_length: z.enum(["short", "medium", "long"]).optional(),
      fallback_message: z.string().optional(),
      max_tokens: z.number().optional(),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const updates: any = { updated_at: new Date().toISOString() };
      for (const key of ["primary_model", "primary_temperature", "system_instructions", "enabled_tools", "response_length", "fallback_message", "max_tokens"]) {
        if (params[key] !== undefined) updates[key] = params[key];
      }
      const { data, error } = await supabase
        .from("company_ai_overrides")
        .update(updates)
        .eq("company_id", companyId)
        .select()
        .single();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ action: "updated", company_id: companyId, config: data }, null, 2) }] };
    },
  });

  server.tool("list_payment_transactions", {
    description: "List payment transactions for revenue tracking and financial analysis.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results (default 50)"),
      status: z.string().optional().describe("Filter: completed, pending, failed"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      let query = supabase
        .from("payment_transactions")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(params?.limit || 50);
      if (params?.status) query = query.eq("payment_status", params.status);
      const { data, error } = await query;
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ transactions: data }, null, 2) }] };
    },
  });

  server.tool("get_agent_strategy", {
    description: "Read current agent routing, strategy settings, and content scheduling preferences.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const [aiRes, agentRes] = await Promise.all([
        supabase.from("company_ai_overrides").select("routing_enabled, routing_model, routing_confidence_threshold, enabled_tools, service_mode, supervisor_enabled").eq("company_id", companyId).maybeSingle(),
        supabase.from("agent_settings").select("*").eq("company_id", companyId).maybeSingle(),
      ]);
      return { content: [{ type: "text" as const, text: JSON.stringify({ routing: aiRes.data, content_strategy: agentRes.data }, null, 2) }] };
    },
  });

  // ═══════════════════════════════════════════════════════════
  // SAFETY GUARDRAIL TOOLS
  // ═══════════════════════════════════════════════════════════

  server.tool("get_spending_guard", {
    description: "Check if the agent is within daily spending limits. MUST be called before any spend action.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data: limits } = await supabase
        .from("agent_spending_limits")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: todayTxns } = await supabase
        .from("payment_transactions")
        .select("amount")
        .eq("company_id", companyId)
        .gte("created_at", todayStart.toISOString());

      const todaySpend = (todayTxns || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
      const dailyLimit = limits?.daily_ad_budget_limit || 50;
      const saleThreshold = limits?.sale_approval_threshold || 500;

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          allowed: todaySpend < dailyLimit,
          today_spend: todaySpend,
          daily_limit: dailyLimit,
          remaining: Math.max(0, dailyLimit - todaySpend),
          sale_approval_threshold: saleThreshold,
          require_approval_for_ai_config: limits?.require_approval_for_ai_config ?? true,
          require_approval_for_publishing: limits?.require_approval_for_publishing ?? false,
        }, null, 2) }],
      };
    },
  });

  server.tool("request_approval", {
    description: "Send a Human-in-the-Loop approval request to the company owner via WhatsApp.",
    inputSchema: z.object({
      action_type: z.string().describe("Type: sale, ai_config_change, publish, expense"),
      action_summary: z.string().describe("Human-readable summary of what you want to do"),
      action_params: z.any().optional().describe("Parameters of the proposed action"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data: request, error: insertErr } = await supabase
        .from("agent_approval_requests")
        .insert({
          company_id: companyId,
          action_type: params.action_type,
          action_summary: params.action_summary,
          action_params: params.action_params || {},
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      const { data: company } = await supabase.from("companies").select("boss_phone, name").eq("id", companyId).single();
      if (company?.boss_phone) {
        const msg = `🤖 *Agent Approval Request*\n\nAction: ${params.action_type}\n${params.action_summary}\n\nReply YES to approve or NO to reject.\n\n_Request ID: ${request.id}_`;
        await callEdgeFunction("send-whatsapp-message", {
          company_id: companyId,
          phone: company.boss_phone,
          message: msg,
        });
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ status: "pending", request_id: request.id, notified: !!company?.boss_phone }, null, 2) }] };
    },
  });

  server.tool("get_financial_health", {
    description: "Check company financial health: credit balance + BMS P&L. Returns mode: 'expansion' if profitable, 'cost_cutting' if in the red.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = resolveCompanyId(params?.company_id);
      const { data: company } = await supabase.from("companies").select("credit_balance, name").eq("id", companyId).single();

      let bmsHealth: any = null;
      try {
        bmsHealth = await callBmsViaEdge("profit_loss_report", companyId, {});
      } catch (_e) {
        // BMS may not be connected
      }

      const creditBalance = company?.credit_balance || 0;
      const mode = creditBalance > 0 ? "expansion" : "cost_cutting";

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          mode,
          credit_balance: creditBalance,
          bms_pnl: bmsHealth?.data || null,
          recommendation: mode === "expansion"
            ? "Company is healthy. Proceed with growth initiatives."
            : "Company credits are low. Focus on revenue-generating activities and minimize spend.",
        }, null, 2) }],
      };
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
  Object.entries(corsHeaders).forEach(([k, v]) => c.res.headers.set(k, v));
});

app.all("/*", async (c) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authResult = await authenticateApiKey(c.req.raw, supabase);
  if (authResult instanceof Response) return authResult;

  // Use mcp-session-id (or fall back to key id) to scope active-company switching
  const sessionId = c.req.raw.headers.get("mcp-session-id") || `key:${authResult.keyId}`;

  const mcpServer = createMcpServer(supabase, authResult, sessionId);
  const transport = new StreamableHttpTransport();
  const httpHandler = transport.bind(mcpServer);
  return await httpHandler(c.req.raw);
});

Deno.serve(app.fetch);
