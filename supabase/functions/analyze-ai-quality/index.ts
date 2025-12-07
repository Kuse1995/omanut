import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QualityAnalysis {
  quality_score: number;
  confidence_score: number;
  detected_flags: string[];
  should_flag: boolean;
  analysis_details: {
    tone_issues: boolean;
    incomplete_response: boolean;
    potential_hallucination: boolean;
    off_topic: boolean;
    too_verbose: boolean;
    missing_action: boolean;
    broken_promise: boolean;
    reasoning: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      customer_message, 
      ai_response, 
      company_id, 
      conversation_id,
      context 
    } = await req.json();

    if (!customer_message || !ai_response || !company_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`Analyzing AI quality for company ${company_id}`);

    // Use Lovable AI to analyze response quality
    const analysisPrompt = `You are an AI quality analyzer. Analyze this customer service interaction and provide a quality assessment.

CUSTOMER MESSAGE:
${customer_message}

AI RESPONSE:
${ai_response}

${context ? `CONTEXT: ${context}` : ''}

Analyze for these issues:
1. TONE_ISSUES: Is the tone inappropriate, rude, or unprofessional?
2. INCOMPLETE_RESPONSE: Does it fail to address the customer's question fully?
3. POTENTIAL_HALLUCINATION: Does it contain information that seems made up or inaccurate?
4. OFF_TOPIC: Does it deviate from what the customer asked?
5. TOO_VERBOSE: Is it unnecessarily long when brevity would be better?
6. MISSING_ACTION: Should the AI have taken an action (like booking, sending info) but didn't?
7. BROKEN_PROMISE: Does it promise something the system can't deliver?

Respond with ONLY a JSON object (no markdown, no code blocks):
{
  "quality_score": <0-100, where 100 is perfect>,
  "confidence_score": <0-100, your confidence in this assessment>,
  "tone_issues": <true/false>,
  "incomplete_response": <true/false>,
  "potential_hallucination": <true/false>,
  "off_topic": <true/false>,
  "too_verbose": <true/false>,
  "missing_action": <true/false>,
  "broken_promise": <true/false>,
  "reasoning": "<brief explanation of your assessment>"
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a quality assessment AI. Always respond with valid JSON only." },
          { role: "user", content: analysisPrompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.choices?.[0]?.message?.content || "";
    
    console.log("Raw analysis:", analysisText);

    // Parse the JSON response
    let analysis: any;
    try {
      // Clean up potential markdown formatting
      const cleanJson = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error("Failed to parse analysis:", parseError);
      // Fallback to default scores if parsing fails
      analysis = {
        quality_score: 70,
        confidence_score: 50,
        tone_issues: false,
        incomplete_response: false,
        potential_hallucination: false,
        off_topic: false,
        too_verbose: false,
        missing_action: false,
        broken_promise: false,
        reasoning: "Unable to analyze - using default scores"
      };
    }

    // Build detected flags array
    const detected_flags: string[] = [];
    if (analysis.tone_issues) detected_flags.push("tone_issue");
    if (analysis.incomplete_response) detected_flags.push("incomplete");
    if (analysis.potential_hallucination) detected_flags.push("hallucination");
    if (analysis.off_topic) detected_flags.push("off_topic");
    if (analysis.too_verbose) detected_flags.push("verbose");
    if (analysis.missing_action) detected_flags.push("missing_action");
    if (analysis.broken_promise) detected_flags.push("broken_promise");

    // Determine if we should auto-flag (quality below 70 or any critical flags)
    const criticalFlags = ["hallucination", "broken_promise", "tone_issue"];
    const hasCriticalFlag = detected_flags.some(f => criticalFlags.includes(f));
    const should_flag = analysis.quality_score < 70 || hasCriticalFlag;

    const qualityResult: QualityAnalysis = {
      quality_score: analysis.quality_score,
      confidence_score: analysis.confidence_score,
      detected_flags,
      should_flag,
      analysis_details: {
        tone_issues: analysis.tone_issues,
        incomplete_response: analysis.incomplete_response,
        potential_hallucination: analysis.potential_hallucination,
        off_topic: analysis.off_topic,
        too_verbose: analysis.too_verbose,
        missing_action: analysis.missing_action,
        broken_promise: analysis.broken_promise,
        reasoning: analysis.reasoning
      }
    };

    console.log("Quality analysis result:", qualityResult);

    // If should flag, auto-create error log entry
    if (should_flag) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Determine error type based on flags
      let error_type = "other";
      if (analysis.potential_hallucination) error_type = "hallucination";
      else if (analysis.tone_issues) error_type = "tone_issue";
      else if (analysis.incomplete_response) error_type = "missing_info";
      else if (analysis.broken_promise) error_type = "wrong_response";

      // Determine severity
      let severity = "medium";
      if (analysis.quality_score < 40 || hasCriticalFlag) severity = "critical";
      else if (analysis.quality_score < 60) severity = "high";
      else if (analysis.quality_score < 80) severity = "medium";
      else severity = "low";

      const { error: insertError } = await supabase
        .from("ai_error_logs")
        .insert({
          company_id,
          conversation_id: conversation_id || null,
          error_type,
          severity,
          original_message: customer_message,
          ai_response: ai_response,
          status: "open",
          quality_score: analysis.quality_score,
          confidence_score: analysis.confidence_score,
          detected_flags,
          auto_flagged: true,
          analysis_details: qualityResult.analysis_details
        });

      if (insertError) {
        console.error("Failed to insert error log:", insertError);
      } else {
        console.log("Auto-flagged AI response for review");
      }
    }

    return new Response(
      JSON.stringify(qualityResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in analyze-ai-quality:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
