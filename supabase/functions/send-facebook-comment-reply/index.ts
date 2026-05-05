import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertTenantContext, loadTenantFromRecord } from "../_shared/tenant-context.ts";
import { logTenantViolation, logSecurityEvent } from "../_shared/security-logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { draft_id, comment_id, message, company_id } = payload;

    // ACCEPT BOTH MODES: Human Draft (draft_id) OR Autonomous Agent (comment_id + message)
    if (!draft_id && (!comment_id || !message)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: Provide either draft_id OR (comment_id, message)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Detect service-role calls (OpenClaw / autonomous agents) vs human users
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseServiceKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;
    }

    // =========================================================
    // MODE 1: HUMAN-IN-THE-LOOP (REQUIRES DRAFT_ID)
    // =========================================================
    if (draft_id) {
      const { data: draft, error: draftError } = await supabase
        .from("message_reply_drafts")
        .select("*")
        .eq("id", draft_id)
        .single();

      if (draftError || !draft) {
        return new Response(JSON.stringify({ error: "Draft not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cId = loadTenantFromRecord(draft, "message_reply_draft");
      assertTenantContext(cId, "send-facebook-comment-reply");

      if (!isServiceRole) {
        const { data: hasRole } = await supabase.rpc("has_company_role", {
          company_uuid: cId,
          required_role: "manager",
        });
        if (!hasRole) {
          await logSecurityEvent(supabase, {
            eventType: "role_insufficient",
            severity: "warning",
            source: "send-facebook-comment-reply",
            message: `User ${userId} lacks manager role`,
            companyId: cId,
            userId: userId ?? undefined,
          });
          return new Response(JSON.stringify({ error: "Insufficient permissions. Manager role required." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      if (draft.status !== "approved") {
        return new Response(JSON.stringify({ error: `Draft must be approved first. Current status: ${draft.status}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: originalComment, error: ocErr } = await supabase
        .from("facebook_comments")
        .select("comment_id, page_id")
        .eq("id", draft.source_id)
        .single();

      if (ocErr || !originalComment) {
        return new Response(JSON.stringify({ error: "Original comment not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: fbPage, error: pageError } = await supabase
        .from("facebook_pages")
        .select("page_access_token")
        .eq("page_id", originalComment.page_id)
        .single();

      if (pageError || !fbPage?.page_access_token) {
        return new Response(JSON.stringify({ error: "Facebook page configuration not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const metaResponse = await fetch(
        `https://graph.facebook.com/v18.0/${originalComment.comment_id}/comments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${fbPage.page_access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: draft.ai_reply }),
        }
      );

      if (!metaResponse.ok) {
        const errorData = await metaResponse.json();
        console.error("Meta API error:", errorData);
        await supabase
          .from("message_reply_drafts")
          .update({
            prompt_context: {
              ...draft.prompt_context,
              send_error: errorData,
              send_attempted_at: new Date().toISOString(),
            },
          })
          .eq("id", draft_id);
        return new Response(JSON.stringify({ error: "Failed to send comment reply via Facebook", details: errorData }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const metaResult = await metaResponse.json();

      await supabase
        .from("message_reply_drafts")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          prompt_context: {
            ...draft.prompt_context,
            meta_comment_id: metaResult.id,
            sent_by: userId,
          },
        })
        .eq("id", draft_id);

      console.log(`[send-facebook-comment-reply] Sent draft ${draft_id} as comment ${metaResult.id}`);

      return new Response(
        JSON.stringify({ success: true, comment_id: metaResult.id, message: "Comment reply sent successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================
    // MODE 2: AUTONOMOUS AGENT (DIRECT COMMENT_ID & MESSAGE)
    // =========================================================
    if (comment_id && message) {
      const { data: originalComment, error: commentError } = await supabase
        .from("facebook_comments")
        .select("company_id, page_id")
        .eq("comment_id", comment_id)
        .single();

      if (commentError || !originalComment) {
        return new Response(JSON.stringify({ error: "Original comment not found in database to map Page Token" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const activeCompanyId = company_id || originalComment.company_id;
      assertTenantContext(activeCompanyId, "send-facebook-comment-reply-direct");

      // For human callers in autonomous mode, still require manager role on the resolved company
      if (!isServiceRole) {
        const { data: hasRole } = await supabase.rpc("has_company_role", {
          company_uuid: activeCompanyId,
          required_role: "manager",
        });
        if (!hasRole) {
          return new Response(JSON.stringify({ error: "Insufficient permissions. Manager role required." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { data: fbPage, error: pageError } = await supabase
        .from("facebook_pages")
        .select("page_access_token")
        .eq("page_id", originalComment.page_id)
        .single();

      if (pageError || !fbPage?.page_access_token) {
        return new Response(JSON.stringify({ error: "Facebook page token not configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const metaResponse = await fetch(`https://graph.facebook.com/v18.0/${comment_id}/comments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fbPage.page_access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      if (!metaResponse.ok) {
        const errorData = await metaResponse.json();
        console.error("Meta API error (autonomous):", errorData);
        return new Response(JSON.stringify({ error: "Meta API error", details: errorData }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const metaResult = await metaResponse.json();
      console.log(`[send-facebook-comment-reply] Autonomous reply sent as comment ${metaResult.id}`);

      return new Response(
        JSON.stringify({ success: true, comment_id: metaResult.id, message: "Autonomous reply sent successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unhandled request shape" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-facebook-comment-reply:", error);
    return new Response(JSON.stringify({ error: "An error occurred processing your request" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
