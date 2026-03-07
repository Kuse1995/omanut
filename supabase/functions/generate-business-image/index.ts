import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Using Gemini client

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get auth user
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's company
    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (!userData?.company_id) {
      throw new Error('User not associated with a company');
    }

    const { prompt, conversationId } = await req.json();

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get image generation settings
    const { data: settings } = await supabase
      .from('image_generation_settings')
      .select('*')
      .eq('company_id', userData.company_id)
      .single();

    if (!settings?.enabled) {
      return new Response(
        JSON.stringify({ error: 'Image generation is not enabled for this company' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get company info for context
    const { data: company } = await supabase
      .from('companies')
      .select('business_type, name')
      .eq('id', userData.company_id)
      .single();

    // Enhance prompt with business context
    let enhancedPrompt = prompt;
    if (settings.business_context) {
      enhancedPrompt = `${settings.business_context}. ${prompt}`;
    }
    if (settings.style_description) {
      enhancedPrompt += `. Style: ${settings.style_description}`;
    }
    enhancedPrompt += `. Ultra high resolution, professional ${company?.business_type || 'business'} image.`;

    console.log('Generating image with prompt:', enhancedPrompt);

    // Call Gemini AI for image generation
    const response = await geminiChat({
      model: 'gemini-2.5-flash-image-preview',
      messages: [
        {
          role: 'user',
          content: enhancedPrompt
        }
      ],
      modalities: ['image', 'text']
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini AI error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`Gemini AI error: ${response.status}`);
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      throw new Error('No image generated');
    }

    // Save generated image record
    const { data: savedImage, error: saveError } = await supabase
      .from('generated_images')
      .insert({
        company_id: userData.company_id,
        conversation_id: conversationId || null,
        prompt: prompt,
        image_url: imageUrl
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving image record:', saveError);
    }

    return new Response(
      JSON.stringify({ 
        image_url: imageUrl,
        image_id: savedImage?.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating image:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
