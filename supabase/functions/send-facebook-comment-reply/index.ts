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
    const { draft_id } = await req.json();

    if (!draft_id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: draft_id" }),
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

    // Create user client for auth
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

    // Create service client for data operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load the draft - tenant context comes from DB
    const { data: draft, error: draftError } = await supabase
      .from("message_reply_drafts")
      .select("*")
      .eq("id", draft_id)
      .single();

    if (draftError || !draft) {
      return new Response(
        JSON.stringify({ error: "Draft not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get company_id from the DB record, not from user input
    const companyId = loadTenantFromRecord(draft, "message_reply_draft");
    assertTenantContext(companyId, "send-facebook-comment-reply");

    // Verify user has manager+ role
    const { data: hasRole } = await supabase.rpc("has_company_role", {
      company_uuid: companyId,
      required_role: "manager",
    });

    if (!hasRole) {
      await logSecurityEvent(supabase, {
        eventType: "role_insufficient",
        severity: "warning",
        source: "send-facebook-comment-reply",
        message: `User ${user.id} lacks manager role for sending comment replies`,
        companyId: companyId,
        userId: user.id,
      });

      return new Response(
        JSON.stringify({ error: "Insufficient permissions. Manager role required to send replies." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify draft is approved
    if (draft.status !== "approved") {
      return new Response(
        JSON.stringify({ error: `Cannot send draft with status: ${draft.status}. Must be approved first.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify source type
    if (draft.source_type !== "facebook_comment") {
      return new Response(
        JSON.stringify({ error: "This endpoint is for Facebook comments only" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load the original comment to get comment ID for reply
    const { data: originalComment, error: commentError } = await supabase
      .from("facebook_comments")
      .select("comment_id, page_id")
      .eq("id", draft.source_id)
      .single();

    if (commentError || !originalComment) {
      return new Response(
        JSON.stringify({ error: "Original comment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load page access token
    const { data: fbPage, error: pageError } = await supabase
      .from("facebook_pages")
      .select("page_access_token")
      .eq("page_id", originalComment.page_id)
      .single();

    if (pageError || !fbPage?.page_access_token) {
      console.error("Failed to load Facebook page access token:", pageError);
      return new Response(
        JSON.stringify({ error: "Facebook page configuration not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reply to the comment via Meta Graph API
    const metaResponse = await fetch(
      `https://graph.facebook.com/v18.0/${originalComment.comment_id}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fbPage.page_access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: draft.ai_reply,
        }),
      }
    );

    if (!metaResponse.ok) {
      const errorData = await metaResponse.json();
      console.error("Meta API error:", errorData);

      await logSecurityEvent(supabase, {
        eventType: "invalid_request",
        severity: "error",
        source: "send-facebook-comment-reply",
        message: `Failed to send Facebook comment reply: ${JSON.stringify(errorData)}`,
        companyId: companyId,
        userId: user.id,
        details: { draft_id, error: errorData },
      });

      // Update draft with failure info
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

      return new Response(
        JSON.stringify({ error: "Failed to send comment reply via Facebook", details: errorData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const metaResult = await metaResponse.json();

    // Update draft status to sent
    const { error: updateError } = await supabase
      .from("message_reply_drafts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        prompt_context: {
          ...draft.prompt_context,
          meta_comment_id: metaResult.id,
          sent_by: user.id,
        },
      })
      .eq("id", draft_id);

    if (updateError) {
      console.error("Failed to update draft status:", updateError);
    }

    console.log(`[send-facebook-comment-reply] Sent draft ${draft_id} as comment reply ${metaResult.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        comment_id: metaResult.id,
        message: "Comment reply sent successfully"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in send-facebook-comment-reply:", error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
