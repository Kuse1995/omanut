import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { conversation_id } = await req.json();
    
    if (!conversation_id) {
      throw new Error('conversation_id is required');
    }

    // Get conversation data
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      throw new Error('Conversation not found');
    }

    if (!conversation.transcript || conversation.transcript.trim() === '') {
      console.log('No transcript to analyze');
      return new Response(JSON.stringify({ message: 'No transcript to analyze' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use AI to extract important information and action items
    const analysisPrompt = `Analyze the following customer service conversation transcript and extract:

1. Important client information (preferences, dietary restrictions, special occasions, feedback, complaints)
2. Action items and reminders (follow-ups needed, callbacks, special requests, complaints to address)

Conversation:
${conversation.transcript}

Customer: ${conversation.customer_name || 'Unknown'}
Phone: ${conversation.phone || 'N/A'}

Return your analysis in the following JSON format:
{
  "client_information": [
    {
      "info_type": "preference|dietary|special_occasion|feedback|other",
      "information": "description",
      "importance": "low|normal|high"
    }
  ],
  "action_items": [
    {
      "action_type": "follow_up|callback|special_request|complaint|feedback",
      "description": "what needs to be done",
      "priority": "low|medium|high|urgent",
      "due_date": "ISO date string if mentioned, otherwise null"
    }
  ]
}

Only include items that are genuinely important. If there's nothing significant, return empty arrays.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that analyzes customer service conversations and extracts actionable insights.' },
          { role: 'user', content: analysisPrompt }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiData = await response.json();
    const analysis = JSON.parse(aiData.choices[0].message.content);
    console.log('AI Analysis:', analysis);

    // Store client information
    if (analysis.client_information && analysis.client_information.length > 0) {
      const clientInfoRecords = analysis.client_information.map((info: any) => ({
        company_id: conversation.company_id,
        conversation_id: conversation.id,
        customer_name: conversation.customer_name,
        customer_phone: conversation.phone,
        info_type: info.info_type,
        information: info.information,
        importance: info.importance || 'normal',
      }));

      const { error: infoError } = await supabase
        .from('client_information')
        .insert(clientInfoRecords);

      if (infoError) {
        console.error('Error storing client information:', infoError);
      }
    }

    // Store action items
    if (analysis.action_items && analysis.action_items.length > 0) {
      const actionItemRecords = analysis.action_items.map((item: any) => ({
        company_id: conversation.company_id,
        conversation_id: conversation.id,
        customer_name: conversation.customer_name,
        customer_phone: conversation.phone,
        action_type: item.action_type,
        description: item.description,
        priority: item.priority || 'medium',
        due_date: item.due_date || null,
        status: 'pending',
      }));

      const { error: actionError } = await supabase
        .from('action_items')
        .insert(actionItemRecords);

      if (actionError) {
        console.error('Error storing action items:', actionError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      client_info_count: analysis.client_information?.length || 0,
      action_items_count: analysis.action_items?.length || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
