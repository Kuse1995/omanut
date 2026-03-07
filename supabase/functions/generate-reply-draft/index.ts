import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertTenantContext, loadTenantFromRecord } from "../_shared/tenant-context.ts";
import { logTenantViolation, logSecurityEvent } from "../_shared/security-logging.ts";
import { geminiChat } from "../_shared/gemini-client.ts";
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
    const { source_type, source_id, company_id } = await req.json();

    if (!source_type || !source_id || !company_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: source_type, source_id, company_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["facebook_message", "facebook_comment"].includes(source_type)) {
      return new Response(
        JSON.stringify({ error: "Invalid source_type. Must be facebook_message or facebook_comment" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

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

    // Verify user has contributor+ role for the company
    const { data: hasRole } = await supabase.rpc("has_company_role", {
      company_uuid: company_id,
      required_role: "contributor",
    });

    if (!hasRole) {
      await logSecurityEvent(supabase, {
        eventType: "role_insufficient",
        severity: "warning",
        source: "generate-reply-draft",
        message: `User ${user.id} lacks contributor role for company ${company_id}`,
        companyId: company_id,
        userId: user.id,
      });

      return new Response(
        JSON.stringify({ error: "Insufficient permissions. Contributor role required." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load source content based on type
    let sourceContent = "";
    let senderInfo = "";
    let verifiedCompanyId = "";

    if (source_type === "facebook_message") {
      const { data: message, error: msgError } = await supabase
        .from("facebook_messages")
        .select("*")
        .eq("id", source_id)
        .single();

      if (msgError || !message) {
        return new Response(
          JSON.stringify({ error: "Message not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify tenant context from DB record
      verifiedCompanyId = loadTenantFromRecord(message, "facebook_message");
      
      if (verifiedCompanyId !== company_id) {
        await logTenantViolation(supabase, "generate-reply-draft", 
          `Company mismatch: requested ${company_id}, record belongs to ${verifiedCompanyId}`);
        return new Response(
          JSON.stringify({ error: "Tenant mismatch" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      sourceContent = message.message_text || "";
      senderInfo = message.sender_psid || "Unknown sender";
    } else {
      const { data: comment, error: commentError } = await supabase
        .from("facebook_comments")
        .select("*")
        .eq("id", source_id)
        .single();

      if (commentError || !comment) {
        return new Response(
          JSON.stringify({ error: "Comment not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify tenant context from DB record
      verifiedCompanyId = loadTenantFromRecord(comment, "facebook_comment");
      
      if (verifiedCompanyId !== company_id) {
        await logTenantViolation(supabase, "generate-reply-draft", 
          `Company mismatch: requested ${company_id}, record belongs to ${verifiedCompanyId}`);
        return new Response(
          JSON.stringify({ error: "Tenant mismatch" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      sourceContent = comment.comment_text || "";
      senderInfo = comment.commenter_name || "Unknown commenter";
    }

    // Load company context for brand tone
    const { data: company } = await supabase
      .from("companies")
      .select("name, business_type, voice_style")
      .eq("id", verifiedCompanyId)
      .single();

    const { data: aiOverrides } = await supabase
      .from("company_ai_overrides")
      .select("system_instructions, response_length, qa_style")
      .eq("company_id", verifiedCompanyId)
      .single();

    const { data: imageSettings } = await supabase
      .from("image_generation_settings")
      .select("brand_tone, business_context")
      .eq("company_id", verifiedCompanyId)
      .single();

    // Build prompt with brand context
    const brandContext = `
Company: ${company?.name || "Unknown"}
Business Type: ${company?.business_type || "general"}
Voice Style: ${company?.voice_style || "professional and friendly"}
Brand Tone: ${imageSettings?.brand_tone || "professional"}
Business Context: ${imageSettings?.business_context || ""}
Custom Instructions: ${aiOverrides?.system_instructions || ""}
    `.trim();

    const systemPrompt = `You are a social media community manager for ${company?.name || "a business"}.
Generate a helpful, on-brand reply to the following ${source_type === "facebook_message" ? "Facebook message" : "Facebook comment"}.

${brandContext}

Guidelines:
- Match the brand's voice and tone
- Be helpful and professional
- Keep responses concise but warm
- Address the customer's concern or question directly
- Never include hashtags unless relevant to the conversation
- Do not include emojis unless the brand tone suggests it`;

    const userPrompt = `From: ${senderInfo}
Message: ${sourceContent}

Generate a professional reply:`;

    // Generate AI reply using Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 500,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to generate AI reply" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const generatedReply = aiData.choices?.[0]?.message?.content || "";

    if (!generatedReply) {
      return new Response(
        JSON.stringify({ error: "AI generated empty response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save as draft - NEVER auto-send
    const { data: draft, error: insertError } = await supabase
      .from("message_reply_drafts")
      .insert({
        company_id: verifiedCompanyId,
        source_type,
        source_id,
        ai_reply: generatedReply,
        prompt_context: {
          source_content: sourceContent,
          sender_info: senderInfo,
          brand_context: brandContext,
          generated_at: new Date().toISOString(),
          generated_by: user.id,
        },
        status: "draft",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to save draft:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to save draft" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-reply-draft] Created draft ${draft.id} for ${source_type} ${source_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        draft,
        message: "Draft generated successfully. Awaiting approval."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in generate-reply-draft:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
