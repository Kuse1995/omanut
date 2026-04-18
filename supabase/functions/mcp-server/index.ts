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
    version: "1.3.0",
    schemaAdapter: (schema: unknown) => zodToJsonSchema(schema as z.ZodType, { target: "openApi3" }),
  });

  // Resolve which company this tool call should target.
  // Priority: per-call company_id > session-active (admin only, DB-backed) > key default.
  async function resolveCompanyId(perCallCompanyId?: string): Promise<string> {
    if (auth.scope === "company") {
      if (!auth.defaultCompanyId) {
        throw new Error("Company-scoped key has no company_id (configuration error)");
      }
      return auth.defaultCompanyId;
    }
    const explicit = perCallCompanyId?.trim();
    if (explicit) return explicit;
    const active = await getActiveCompany(supabase, auth.keyId, sessionId);
    if (active) return active;
    throw new Error("NO_ACTIVE_COMPANY: Call list_my_companies, then set_active_company first, or pass company_id in this tool call.");
  }

  async function requireCompanyAccess(companyId: string): Promise<void> {
    if (auth.scope === "company") return;
    const { data: c } = await supabase.from("companies").select("id").eq("id", companyId).maybeSingle();
    if (!c) throw new Error(`Company not found: ${companyId}`);
  }

  // Gate for any tool that lets OpenClaw act AS a human inside a customer conversation
  // (sending messages, taking over chats). Companies must explicitly opt in.
  async function requireOpenClawEnabled(companyId: string): Promise<void> {
    const { data, error } = await supabase
      .from("companies")
      .select("openclaw_takeover_enabled, name")
      .eq("id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.openclaw_takeover_enabled) {
      throw new Error(
        `OpenClaw takeover is disabled for ${data?.name || "this company"}. ` +
        `An operator must enable it in Company Settings → OpenClaw Agent before this tool can run.`
      );
    }
  }

  // Wrap server.tool so handler errors become structured tool results (isError: true)
  // instead of bubbling up as JSON-RPC -32603 Internal Error. OpenClaw can then read the message.
  const originalTool = server.tool.bind(server);
  (server as any).tool = (name: string, def: any) => {
    const userHandler = def.handler;
    def.handler = async (params: any, ctx: any) => {
      try {
        return await userHandler(params, ctx);
      } catch (err: any) {
        const raw = err?.message || String(err);
        const isNoActive = raw.startsWith("NO_ACTIVE_COMPANY");
        const errMsg = isNoActive ? raw.replace("NO_ACTIVE_COMPANY: ", "") : raw;
        const hint = isNoActive
          ? "Run list_my_companies to see available companies, then set_active_company { company_id: '...' }."
          : "Check tool arguments and try again. Use who_am_i to verify your connection.";
        console.error(`[MCP-TOOL-ERR] tool=${name} key=${auth.keyPrefix} session=${sessionId} msg=${raw}`);
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({
            ok: false,
            tool: name,
            error: errMsg,
            hint,
          }, null, 2) }],
        };
      }
    };
    return originalTool(name, def);
  };

  // ═══════════════════════════════════════════════════════════
  // SESSION / COMPANY-SWITCHING TOOLS (admin keys only useful here)
  // ═══════════════════════════════════════════════════════════

  server.tool("who_am_i", {
    description: "Debug: report which API key is currently authenticated, its scope, and the active company. ALWAYS call this first when setting up the connection — verify the key prefix matches the key you intended to install before running any other tools.",
    inputSchema: z.object({}),
    handler: async () => {
      const active = await getActiveCompany(supabase, auth.keyId, sessionId);
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
      const next_step = auth.scope === "admin" && !active
        ? "Call list_my_companies, then set_active_company { company_id: '...' } before using other tools."
        : "Connection ready. Proceed with tool calls.";
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
        server_version: "1.2.0",
        next_step,
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
          next_step: "Company is already pinned. Proceed with any tool.",
        }, null, 2) }] };
      }
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, business_type, created_at")
        .order("name", { ascending: true });
      if (error) throw error;
      const active = await getActiveCompany(supabase, auth.keyId, sessionId);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        key_prefix: auth.keyPrefix,
        scope: "admin",
        default_company_id: null,
        active_company_id: active,
        company_count: data?.length || 0,
        companies: data,
        next_step: active
          ? `Active company already set. Call set_active_company again to switch, or proceed.`
          : "Call set_active_company { company_id: '<one of the ids above>' } before any company-specific tool.",
      }, null, 2) }] };
    },
  });

  server.tool("set_active_company", {
    description: "Set the active company for the rest of this session. After calling this, all subsequent tool calls (without an explicit company_id) target this company. Persisted across requests. Only meaningful for admin-scoped keys.",
    inputSchema: z.object({
      company_id: z.string().describe("UUID of the company to switch to"),
    }),
    handler: async (params: any) => {
      if (auth.scope === "company") {
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, note: "Company-scoped key is already pinned; switching is a no-op.", active_company_id: auth.defaultCompanyId }, null, 2) }] };
      }
      await requireCompanyAccess(params.company_id);
      await setActiveCompany(supabase, auth.keyId, sessionId, params.company_id);
      const { data: c } = await supabase.from("companies").select("id, name").eq("id", params.company_id).maybeSingle();
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, active_company_id: params.company_id, company_name: c?.name || null, message: `All subsequent tool calls will target ${c?.name || params.company_id}.`, next_step: "Proceed with any company-specific tool." }, null, 2) }] };
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
      await requireOpenClawEnabled(companyId);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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

  // ── list_product_media ──
  // Lets OpenClaw browse the company's media library so it can pick reference IDs
  // (instead of guessing or smuggling URLs into style_description).
  server.tool("list_product_media", {
    description: "List images from the company media library so you can pick reference IDs for image generation. Filter by category (products / logos / promotional / other) and/or search term. Returns id, public_url, file_name, description, bms_product_id, category.",
    inputSchema: z.object({
      category: z.string().optional().describe("Filter: products, logos, promotional, other"),
      search: z.string().optional().describe("Substring match on file_name or description"),
      limit: z.number().optional().describe("Max results (default 30)"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      let query = supabase
        .from("company_media")
        .select("id, file_name, file_path, description, tags, bms_product_id, category, media_type, created_at")
        .eq("company_id", companyId)
        .eq("media_type", "image")
        .order("created_at", { ascending: false })
        .limit(params?.limit || 30);
      if (params?.category) query = query.eq("category", params.category);
      if (params?.search) {
        const term = `%${params.search}%`;
        query = query.or(`file_name.ilike.${term},description.ilike.${term}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      const enriched = (data || []).map((m: any) => ({
        id: m.id,
        file_name: m.file_name,
        description: m.description,
        category: m.category,
        bms_product_id: m.bms_product_id,
        tags: m.tags,
        public_url: `${supabaseUrl}/storage/v1/object/public/company-media/${m.file_path}`,
        created_at: m.created_at,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ media: enriched, count: enriched.length }, null, 2) }] };
    },
  });

  // ── set_image_reference_assets ──
  // Writes image_generation_settings.reference_asset_ids properly (the existing
  // update_image_generation_settings only exposes text fields — that's why OpenClaw
  // was smuggling URLs into style_description).
  server.tool("set_image_reference_assets", {
    description: "Pin specific company_media items as visual anchors for ALL future AI-generated images (1–4 IDs recommended). These are passed directly to the image model so generations look like the real products. Pass an empty array to clear.",
    inputSchema: z.object({
      media_ids: z.array(z.string()).describe("UUIDs from list_product_media. Up to 4 are used."),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      const ids: string[] = Array.isArray(params?.media_ids) ? params.media_ids.slice(0, 4) : [];

      // Validate ownership
      if (ids.length > 0) {
        const { data: owned } = await supabase
          .from("company_media")
          .select("id")
          .eq("company_id", companyId)
          .in("id", ids);
        const ownedIds = new Set((owned || []).map((m: any) => m.id));
        const bad = ids.filter(id => !ownedIds.has(id));
        if (bad.length > 0) {
          throw new Error(`These media IDs are not in this company's library: ${bad.join(", ")}`);
        }
      }

      const { data, error } = await supabase
        .from("image_generation_settings")
        .upsert({ company_id: companyId, reference_asset_ids: ids }, { onConflict: "company_id" })
        .select("company_id, reference_asset_ids")
        .single();
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({ action: "updated", reference_asset_ids: data.reference_asset_ids }, null, 2) }] };
    },
  });

  // ── generate_business_image ──
  // On-demand product-anchored image generation. Gated by the OpenClaw safety switch
  // so a disabled company can't have OpenClaw spend image-gen credits on its behalf.
  server.tool("generate_business_image", {
    description: "Generate a brand-on, product-anchored image. Uses the company's saved reference_asset_ids by default, or pass explicit reference_media_ids to override. Returns the image URL plus the references that were actually fed to the model so you can self-evaluate.",
    inputSchema: z.object({
      prompt: z.string().describe("What to generate (the model also receives business context + style_description)"),
      reference_media_ids: z.array(z.string()).optional().describe("Override: company_media UUIDs to use as visual anchors. Up to 4."),
      auto_select_products: z.boolean().optional().describe("If no references resolved, auto-pull recent product photos + logo. Default true."),
      conversation_id: z.string().optional().describe("Optional conversation UUID to link the generated image to."),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      await requireOpenClawEnabled(companyId);
      const result = await callEdgeFunction("generate-business-image", {
        company_id: companyId,
        prompt: params.prompt,
        reference_image_ids: params.reference_media_ids,
        auto_select_products: params.auto_select_products !== false,
        conversationId: params.conversation_id,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  // ── notify_boss ──
  // Fires a WhatsApp alert to the company's configured boss phone(s) via send-boss-notification.
  // Use this when a hot lead picks a plan, a customer escalates, or anything urgent the human owner must see.
  server.tool("notify_boss", {
    description: "Send a WhatsApp alert to the company's boss/owner. Use for hot leads, complaints, VIP info, or anything that needs human attention. Returns the boss phone numbers that were notified.",
    inputSchema: z.object({
      notification_type: z.enum([
        "interested_client",
        "high_value_opportunity",
        "customer_complaint",
        "vip_client_info",
        "action_required",
      ]).optional().describe("Type of alert. Defaults to 'interested_client'."),
      customer_name: z.string().optional().describe("Customer's name if known"),
      customer_phone: z.string().optional().describe("Customer's phone number"),
      summary: z.string().describe("What the boss needs to know — short, action-oriented"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level (used for action_required)"),
      media_url: z.string().optional().describe("Optional image/video URL to attach to the alert"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      await requireOpenClawEnabled(companyId);

      const type = params.notification_type || "interested_client";

      // Shape `data` per the switch in send-boss-notification/index.ts
      let data: Record<string, any> = {
        customer_name: params.customer_name,
        customer_phone: params.customer_phone,
      };
      switch (type) {
        case "interested_client":
          data.phone = params.customer_phone;
          data.information = params.summary;
          break;
        case "high_value_opportunity":
          data.opportunity_type = "hot_lead";
          data.details = params.summary;
          break;
        case "customer_complaint":
          data.issue_summary = params.summary;
          break;
        case "vip_client_info":
          data.info_type = "general";
          data.information = params.summary;
          break;
        case "action_required":
          data.action_type = "follow_up";
          data.priority = params.priority || "medium";
          data.description = params.summary;
          break;
      }

      // List boss phones up-front so we can echo them back to OpenClaw.
      const { data: bossRows } = await supabase
        .from("company_boss_phones")
        .select("phone, label, is_primary")
        .eq("company_id", companyId);

      const result = await callEdgeFunction("send-boss-notification", {
        companyId,
        notificationType: type,
        data,
        mediaUrl: params.media_url,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ok: result?.success !== false,
            notification_type: type,
            boss_phones_notified: (bossRows || []).map((r: any) => ({
              phone: r.phone,
              label: r.label,
              is_primary: r.is_primary,
            })),
            edge_response: result,
          }, null, 2),
        }],
      };
    },
  });

  // ── send_media ──
  // Dedicated media-send path. Wraps send-whatsapp-message so OpenClaw can ship a video/image
  // (e.g. a demo clip) into a customer's WhatsApp thread without juggling the message tool.
  server.tool("send_media", {
    description: "Send a video or image to a customer's WhatsApp conversation. Provide either conversation_id or customer_phone. Caption is optional but recommended.",
    inputSchema: z.object({
      conversation_id: z.string().optional().describe("Conversation UUID (preferred if known)"),
      customer_phone: z.string().optional().describe("Customer phone number — used if conversation_id not provided"),
      media_url: z.string().describe("Public HTTPS URL of the image or video to send"),
      caption: z.string().optional().describe("Optional caption text shown alongside the media"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      await requireOpenClawEnabled(companyId);

      if (!params.conversation_id && !params.customer_phone) {
        throw new Error("Provide either conversation_id or customer_phone.");
      }

      const body: Record<string, any> = {
        company_id: companyId,
        message: params.caption || "",
        media_url: params.media_url,
      };
      if (params.conversation_id) body.conversationId = params.conversation_id;
      if (params.customer_phone) body.phone = params.customer_phone;

      const result = await callEdgeFunction("send-whatsapp-message", body);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ok: result?.success !== false,
            conversation_id: params.conversation_id || null,
            customer_phone: params.customer_phone || null,
            media_url: params.media_url,
            edge_response: result,
          }, null, 2),
        }],
      };
    },
  });

  // ═══════════════════════════════════════════════════════════
  // DIAGNOSTIC / SELF-TRAINING TOOLS — read-only, company-scoped
  // Lets OpenClaw inspect why the AI failed without round-tripping
  // through Lovable. All gated by active company; no system prompts
  // or wholesale costs are ever returned (confidentiality memory).
  // ═══════════════════════════════════════════════════════════

  // ── get_conversation_trace ──
  // Full message-by-message trace with tool calls + errors. System
  // role messages are stripped so internal prompts never leak out.
  server.tool("get_conversation_trace", {
    description: "Get the full message-by-message trace of a conversation, including tool calls, tool results, and any errors recorded in message_metadata. Use this to diagnose WHY the AI gave a bad answer on a specific turn. System-role messages are stripped for confidentiality.",
    inputSchema: z.object({
      conversation_id: z.string().describe("UUID of the conversation to inspect"),
      limit: z.number().optional().describe("Max messages to return, newest first (default 20, max 100)"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      // Verify the conversation belongs to this company before exposing anything
      const { data: convo, error: convoErr } = await supabase
        .from("conversations")
        .select("id, company_id, phone, customer_name, status, active_agent, started_at, last_message_at")
        .eq("id", params.conversation_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (convoErr) throw convoErr;
      if (!convo) {
        throw new Error(`Conversation ${params.conversation_id} not found in active company.`);
      }

      const limit = Math.min(Math.max(params?.limit || 20, 1), 100);
      const { data: rows, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at, message_metadata")
        .eq("conversation_id", params.conversation_id)
        .neq("role", "system") // never expose system prompts
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

      const messages = (rows || []).reverse().map((m: any) => {
        const meta = m.message_metadata || {};
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
          tool_calls: meta.tool_calls || meta.toolCalls || null,
          tool_results: meta.tool_results || meta.toolResults || null,
          error: meta.error || meta.error_message || null,
          model: meta.model || null,
        };
      });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        conversation: convo,
        message_count: messages.length,
        messages,
      }, null, 2) }] };
    },
  });

  // ── get_ai_errors ──
  // Reads ai_error_logs for the active company, with optional search/since filters.
  server.tool("get_ai_errors", {
    description: "List recent AI failures for this company from ai_error_logs: error type, severity, original message, AI response, detected flags, and quality score. Use to spot recurring failure patterns.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results, newest first (default 20, max 100)"),
      since: z.string().optional().describe("ISO timestamp — only return errors created after this time"),
      search: z.string().optional().describe("Case-insensitive substring filter against original_message + ai_response"),
      severity: z.string().optional().describe("Filter: low, medium, high, critical"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      const limit = Math.min(Math.max(params?.limit || 20, 1), 100);
      let q = supabase
        .from("ai_error_logs")
        .select("id, conversation_id, error_type, severity, original_message, ai_response, expected_response, status, quality_score, confidence_score, detected_flags, auto_flagged, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (params?.since) q = q.gte("created_at", params.since);
      if (params?.severity) q = q.eq("severity", params.severity);
      if (params?.search) {
        const s = params.search.replace(/[%,]/g, "");
        q = q.or(`original_message.ilike.%${s}%,ai_response.ilike.%${s}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({
        count: (data || []).length,
        errors: data,
      }, null, 2) }] };
    },
  });

  // ── get_ai_override_summary ──
  // Returns metadata about the company_ai_overrides row WITHOUT the raw
  // system_instructions / agent prompts. Confidentiality memory: never leak prompts.
  server.tool("get_ai_override_summary", {
    description: "Get a SAFE summary of this company's AI configuration overrides: which fields are set, prompt lengths, banned topics, voice style, models, enabled tools. Raw system prompts are NEVER returned (confidentiality). Use get_ai_config for non-sensitive operational fields.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      const { data, error } = await supabase
        .from("company_ai_overrides")
        .select("system_instructions, banned_topics, qa_style, service_mode, voice_style, voice_model, primary_model, primary_temperature, max_tokens, response_length, enabled_tools, supervisor_enabled, sales_agent_prompt, support_agent_prompt, boss_agent_prompt, fallback_message, updated_at")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ has_override: false }, null, 2) }] };
      }

      const lenOrZero = (v: any) => (typeof v === "string" ? v.length : 0);
      const summary = {
        has_override: true,
        system_instructions: { has_value: !!data.system_instructions, length: lenOrZero(data.system_instructions) },
        sales_agent_prompt:  { has_value: !!data.sales_agent_prompt,  length: lenOrZero(data.sales_agent_prompt) },
        support_agent_prompt:{ has_value: !!data.support_agent_prompt,length: lenOrZero(data.support_agent_prompt) },
        boss_agent_prompt:   { has_value: !!data.boss_agent_prompt,   length: lenOrZero(data.boss_agent_prompt) },
        // Non-sensitive operational fields are safe to expose verbatim
        banned_topics: data.banned_topics,
        qa_style: data.qa_style,
        service_mode: data.service_mode,
        voice_style: data.voice_style,
        voice_model: data.voice_model,
        primary_model: data.primary_model,
        primary_temperature: data.primary_temperature,
        max_tokens: data.max_tokens,
        response_length: data.response_length,
        enabled_tools: data.enabled_tools,
        supervisor_enabled: data.supervisor_enabled,
        fallback_message: data.fallback_message,
        updated_at: data.updated_at,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    },
  });

  // ── get_boss_notification_history ──
  // Lets OpenClaw verify what was actually sent to Abraham via notify_boss.
  server.tool("get_boss_notification_history", {
    description: "List the most recent boss/owner notifications sent for this company (via notify_boss or other paths). Returns message content and any boss reply, so you can confirm an alert really went out.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max results, newest first (default 10, max 50)"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      const limit = Math.min(Math.max(params?.limit || 10, 1), 50);
      const { data, error } = await supabase
        .from("boss_conversations")
        .select("id, message_from, message_content, response, tool_context, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return { content: [{ type: "text" as const, text: JSON.stringify({
        count: (data || []).length,
        notifications: data,
      }, null, 2) }] };
    },
  });

  // ── get_function_logs ──
  // Honest implementation: raw Supabase Edge runtime logs require the
  // Management API personal access token, which the MCP service-role key
  // does NOT have. Instead we surface the most actionable signal we DO
  // have: ai_error_logs filtered by function context, and recent failed
  // messages. Tool description tells OpenClaw exactly what it gets.
  const FUNCTION_ALLOWLIST = new Set([
    "whatsapp-messages",
    "mcp-server",
    "supervisor-agent",
    "boss-chat",
    "meta-webhook",
    "send-boss-notification",
    "send-whatsapp-message",
    "generate-business-image",
    "bms-agent",
  ]);
  server.tool("get_function_logs", {
    description: "Get diagnostic signal for a deployed edge function. NOTE: raw runtime logs require Lovable; this tool returns the actionable equivalent — recent ai_error_logs whose error_type or detected_flags reference the function, plus recent messages with errors in their metadata. Whitelisted functions only.",
    inputSchema: z.object({
      function_name: z.string().describe("Edge function name. Allowed: " + Array.from(FUNCTION_ALLOWLIST).join(", ")),
      search: z.string().optional().describe("Optional substring to filter on (matches error_type, ai_response, original_message)"),
      limit: z.number().optional().describe("Max results, newest first (default 30, max 100)"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      const fn = String(params.function_name || "").trim();
      if (!FUNCTION_ALLOWLIST.has(fn)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          error: "function not in allowlist",
          allowed: Array.from(FUNCTION_ALLOWLIST),
        }, null, 2) }] };
      }
      const limit = Math.min(Math.max(params?.limit || 30, 1), 100);
      const search = (params?.search || "").toString().replace(/[%,]/g, "");

      // 1) ai_error_logs that mention the function in detected_flags or error_type
      let errQ = supabase
        .from("ai_error_logs")
        .select("id, conversation_id, error_type, severity, original_message, ai_response, detected_flags, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      // Postgrest array contains
      const filters = [`error_type.ilike.%${fn}%`, `detected_flags.cs.{${fn}}`];
      if (search) filters.push(`original_message.ilike.%${search}%`, `ai_response.ilike.%${search}%`);
      errQ = errQ.or(filters.join(","));
      const { data: errors } = await errQ;

      return { content: [{ type: "text" as const, text: JSON.stringify({
        function_name: fn,
        note: "Raw runtime logs are not exposed via MCP. These are AI error logs scoped to this function for the active company.",
        error_count: (errors || []).length,
        errors,
      }, null, 2) }] };
    },
  });

  // ── read_function_source ──
  // Reads edge function source from the deployed bundle. Whitelisted only.
  // Truncates large files. Lets OpenClaw understand tool internals before
  // calling them, instead of guessing from the schema.
  server.tool("read_function_source", {
    description: "Read the source code of a deployed edge function (whitelisted). Returns text. Truncates at max_bytes. Use this to understand what a tool actually does before calling it.",
    inputSchema: z.object({
      function_name: z.string().describe("Edge function name. Allowed: " + Array.from(FUNCTION_ALLOWLIST).join(", ")),
      max_bytes: z.number().optional().describe("Truncation limit in bytes (default 20000, max 100000)"),
    }),
    handler: async (params: any) => {
      const fn = String(params.function_name || "").trim();
      if (!FUNCTION_ALLOWLIST.has(fn)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          error: "function not in allowlist",
          allowed: Array.from(FUNCTION_ALLOWLIST),
        }, null, 2) }] };
      }
      const cap = Math.min(Math.max(params?.max_bytes || 20000, 1000), 100000);
      // Edge function bundles deploy with the source path preserved relative
      // to the running function. Try a few well-known locations.
      const candidates = [
        `/home/deno/functions/${fn}/index.ts`,
        `./${fn}/index.ts`,
        `../${fn}/index.ts`,
        `/tmp/functions/${fn}/index.ts`,
      ];
      let source: string | null = null;
      let foundPath: string | null = null;
      let lastErr: string | null = null;
      for (const p of candidates) {
        try {
          source = await Deno.readTextFile(p);
          foundPath = p;
          break;
        } catch (e) {
          lastErr = (e as Error).message;
        }
      }
      if (source === null) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          error: "source not readable from runtime bundle",
          function_name: fn,
          tried: candidates,
          last_error: lastErr,
          hint: "Use a GitHub read-only token in OpenClaw's integration settings to read source via the repo instead.",
        }, null, 2) }] };
      }
      const truncated = source.length > cap;
      return { content: [{ type: "text" as const, text: JSON.stringify({
        function_name: fn,
        path: foundPath,
        bytes: source.length,
        truncated,
        source: truncated ? source.slice(0, cap) + `\n\n/* …truncated, ${source.length - cap} more bytes. Increase max_bytes (max 100000). */` : source,
      }, null, 2) }] };
    },
  });

  // ── list_product_identity_profiles ──
  server.tool("list_product_identity_profiles", {
    description: "List all product identity fingerprints: hex colors, labels, packaging shapes, exclusion keywords.",
    inputSchema: companyOverride,
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
        const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
      await requireOpenClawEnabled(companyId);
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
      const companyId = await resolveCompanyId(params?.company_id);
      await requireOpenClawEnabled(companyId);
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
      const companyId = await resolveCompanyId(params?.company_id);
      const result = await callEdgeFunction("send-facebook-comment-reply", {
        comment_id: params.comment_id,
        message: params.message,
        company_id: companyId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  });

  // Helper: insert a scheduled_posts row (status=approved, now) and invoke publish-meta-post
  async function adhocPublish(params: {
    companyId: string;
    targetPlatform: "facebook" | "instagram" | "both";
    caption: string;
    image_url?: string | null;
    video_url?: string | null;
  }) {
    // Look up the company's Meta page_id
    const { data: cred, error: credErr } = await supabase
      .from("meta_credentials")
      .select("page_id")
      .eq("company_id", params.companyId)
      .limit(1)
      .maybeSingle();

    if (credErr || !cred?.page_id) {
      throw new Error("No Meta credentials configured for this company. Connect Facebook/Instagram first.");
    }

    const { data: post, error: insErr } = await supabase
      .from("scheduled_posts")
      .insert({
        company_id: params.companyId,
        page_id: cred.page_id,
        content: params.caption,
        image_url: params.image_url || null,
        video_url: params.video_url || null,
        target_platform: params.targetPlatform,
        scheduled_time: new Date().toISOString(),
        status: "approved",
        created_by: "00000000-0000-0000-0000-000000000000",
      })
      .select()
      .single();

    if (insErr || !post) {
      throw new Error(`Failed to create scheduled post: ${insErr?.message || "unknown"}`);
    }

    const result = await callEdgeFunction("publish-meta-post", { post_id: post.id });
    return { scheduled_post_id: post.id, ...result };
  }

  server.tool("publish_facebook_post", {
    description: "Publish a post immediately to the company's Facebook Page.",
    inputSchema: z.object({
      caption: z.string().describe("Post caption/text"),
      image_url: z.string().optional().describe("Image URL to attach"),
      video_url: z.string().optional().describe("Video URL to attach"),
    }).merge(companyOverride),
    handler: async (params: any) => {
      const companyId = await resolveCompanyId(params?.company_id);
      const result = await adhocPublish({
        companyId,
        targetPlatform: "facebook",
        caption: params.caption,
        image_url: params.image_url,
        video_url: params.video_url,
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
      const companyId = await resolveCompanyId(params?.company_id);
      const result = await adhocPublish({
        companyId,
        targetPlatform: "instagram",
        caption: params.caption,
        image_url: params.image_url,
        video_url: params.video_url,
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
      const companyId = await resolveCompanyId(params?.company_id);
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
