import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `oai_${hex}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const { action, company_id, key_id, name, expires_at, scope } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check global admin role first
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!adminRole;

    const requestedScope: "company" | "admin" = scope === "admin" ? "admin" : "company";

    // Admin-scoped keys: only global admins may create/list/revoke (no company_id)
    if (requestedScope === "admin" || (action !== "create" && !company_id)) {
      if (!isAdmin) {
        return new Response(
          JSON.stringify({ error: "Forbidden: admin role required for admin-scoped keys" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // For company-scoped operations: require manager+ on that company (or global admin)
    if (requestedScope === "company") {
      const { data: roleData } = await supabase
        .from("company_users")
        .select("role")
        .eq("user_id", userId)
        .eq("company_id", company_id)
        .single();

      const isManagerOrOwner =
        roleData?.role === "owner" || roleData?.role === "manager";

      if (!isAdmin && !isManagerOrOwner) {
        return new Response(
          JSON.stringify({ error: "Forbidden: requires manager or owner role" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    if (action === "create") {
      const plainKey = generateApiKey();
      const keyHash = await hashKey(plainKey);
      const keyPrefix = plainKey.substring(0, 12);

      const insertPayload: any = {
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name: name || (requestedScope === "admin" ? "Admin Training Key" : "API Key"),
        created_by: userId,
        expires_at: expires_at || null,
        scope: requestedScope,
      };
      if (requestedScope === "company") {
        insertPayload.company_id = company_id;
      } else {
        insertPayload.company_id = null;
      }

      const { data, error } = await supabase
        .from("company_api_keys")
        .insert(insertPayload)
        .select("id, key_prefix, name, created_at, expires_at, scope, company_id")
        .single();

      if (error) throw error;

      // Log security event
      await supabase.from("security_events").insert({
        company_id: requestedScope === "company" ? company_id : null,
        user_id: userId,
        event_type: "api_key_created",
        severity: requestedScope === "admin" ? "warning" : "info",
        source: "manage-api-keys",
        message: `${requestedScope === "admin" ? "Admin training" : ""} API key "${insertPayload.name}" created`,
        details: { key_prefix: keyPrefix, key_id: data.id, scope: requestedScope },
      });

      return new Response(
        JSON.stringify({ ...data, key: plainKey }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "list") {
      let query = supabase
        .from("company_api_keys")
        .select(
          "id, key_prefix, name, is_active, last_used_at, created_at, expires_at, scopes, scope, company_id"
        )
        .order("created_at", { ascending: false });

      if (company_id) {
        query = query.eq("company_id", company_id);
      } else if (isAdmin) {
        // Admin listing — return only admin-scoped keys (no company)
        query = query.eq("scope", "admin");
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ keys: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "revoke") {
      if (!key_id) {
        return new Response(
          JSON.stringify({ error: "key_id is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      let revokeQuery = supabase
        .from("company_api_keys")
        .update({ is_active: false })
        .eq("id", key_id);
      if (company_id) revokeQuery = revokeQuery.eq("company_id", company_id);

      const { error } = await revokeQuery;
      if (error) throw error;

      await supabase.from("security_events").insert({
        company_id: company_id || null,
        user_id: userId,
        event_type: "api_key_revoked",
        severity: "warning",
        source: "manage-api-keys",
        message: `API key revoked`,
        details: { key_id },
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use: create, list, revoke" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("manage-api-keys error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
