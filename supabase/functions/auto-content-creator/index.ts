import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // Using Gemini client

    // Auth - allow service role, no-auth (for cron/testing), or authenticated user
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === supabaseServiceKey || !authHeader;
    let userId: string;

    if (isServiceRole) {
      userId = 'system';
    } else {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    }

    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch company info, AI overrides, image gen settings, meta credentials in parallel
    const [companyRes, aiRes, imgSettingsRes, credRes, mediaRes] = await Promise.all([
      supabaseService.from('companies').select('name, business_type, services, hours, quick_reference_info').eq('id', company_id).single(),
      supabaseService.from('company_ai_overrides').select('system_instructions').eq('company_id', company_id).maybeSingle(),
      supabaseService.from('image_generation_settings').select('style_description, brand_tone, visual_guidelines, brand_colors, business_context').eq('company_id', company_id).maybeSingle(),
      supabaseService.from('meta_credentials').select('page_id, ig_user_id').eq('company_id', company_id).limit(1).maybeSingle(),
      supabaseService.from('company_media').select('file_path, description, tags').eq('company_id', company_id).limit(5),
    ]);

    if (companyRes.error || !companyRes.data) {
      return new Response(JSON.stringify({ error: 'Company not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!credRes.data) {
      return new Response(JSON.stringify({ error: 'No Meta credentials configured. Add a page in Meta Integrations first.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const company = companyRes.data;
    const ai = aiRes.data;
    const imgSettings = imgSettingsRes.data;
    const cred = credRes.data;
    const mediaAssets = mediaRes.data || [];

    // 2. Brainstorm caption using AI
    const captionPrompt = `You are a world-class social media manager for "${company.name}" (${company.business_type || 'business'}).

Company info:
- Services: ${company.services || 'N/A'}
- Hours: ${company.hours || 'N/A'}
- Quick reference: ${company.quick_reference_info || 'N/A'}
${ai?.system_instructions ? `- Brand voice: ${ai.system_instructions.substring(0, 500)}` : ''}
${imgSettings?.brand_tone ? `- Brand tone: ${imgSettings.brand_tone}` : ''}

Create ONE highly engaging social media post caption for Facebook and Instagram. The caption should:
- Be authentic and engaging, not generic
- Include relevant emojis
- Have a clear call-to-action
- Be between 100-300 characters
- Feel natural, not AI-generated

Return ONLY the caption text, nothing else.`;

    const captionResponse = await geminiChat({
      model: 'gemini-3-flash-preview',
      messages: [{ role: 'user', content: captionPrompt }],
    });

    if (!captionResponse.ok) {
      const status = captionResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add funds.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Caption generation failed: ${status}`);
    }

    const captionData = await captionResponse.json();
    const caption = captionData.choices?.[0]?.message?.content?.trim();
    if (!caption) throw new Error('No caption generated');

    console.log(`Caption generated: ${caption.substring(0, 80)}...`);

    // 3. Generate image
    const mediaContext = mediaAssets.map(m => `${m.description || ''} (tags: ${(m.tags || []).join(', ')})`).filter(Boolean).join('; ');

    const imagePrompt = `Create a professional, eye-catching social media image for "${company.name}" (${company.business_type || 'business'}).
${imgSettings?.style_description ? `Style: ${imgSettings.style_description}` : ''}
${imgSettings?.visual_guidelines ? `Guidelines: ${imgSettings.visual_guidelines}` : ''}
${mediaContext ? `Reference style from existing assets: ${mediaContext}` : ''}

The image should match this caption: "${caption}"

Make it vibrant, high-quality, and optimized for social media engagement. Square aspect ratio (1:1).`;

    const imageResponse = await geminiChat({
      model: 'gemini-2.5-flash-image',
      messages: [{ role: 'user', content: imagePrompt }],
      modalities: ['image', 'text'],
    });

    if (!imageResponse.ok) {
      const errBody = await imageResponse.text();
      console.error(`Image generation failed (${imageResponse.status}):`, errBody);
      throw new Error(`Image generation failed: ${imageResponse.status}`);
    }

    const imageData = await imageResponse.json();
    const base64Image = imageData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    let finalImageUrl: string | null = null;

    if (base64Image) {
      // Extract base64 data and upload to storage
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      
      const filePath = `auto-content/${company_id}/${crypto.randomUUID()}.png`;
      
      const { error: uploadError } = await supabaseService.storage
        .from('company-media')
        .upload(filePath, binaryData, {
          contentType: 'image/png',
          upsert: false,
        });

      if (uploadError) {
        console.error('Image upload error:', uploadError);
      } else {
        const { data: publicData } = supabaseService.storage
          .from('company-media')
          .getPublicUrl(filePath);
        finalImageUrl = publicData.publicUrl;
        console.log(`Image uploaded: ${finalImageUrl}`);
      }
    } else {
      console.warn('No image was generated by the AI model');
    }

    // 4. Calculate scheduled time (2 days from now)
    const scheduledTime = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    // 5. Insert into scheduled_posts
    const { data: post, error: insertError } = await supabaseService
      .from('scheduled_posts')
      .insert({
        company_id,
        page_id: cred.page_id,
        content: caption,
        image_url: finalImageUrl,
        scheduled_time: scheduledTime,
        status: 'pending_approval',
        target_platform: cred.ig_user_id ? 'both' : 'facebook',
        created_by: userId,
      })
      .select('id, content, image_url, scheduled_time, target_platform')
      .single();

    if (insertError) throw insertError;

    console.log(`Auto-content created: ${post.id}`);

    return new Response(JSON.stringify({
      success: true,
      post,
      message: 'Content created and awaiting your approval!',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in auto-content-creator:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
