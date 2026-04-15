import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { geminiChat, geminiImageGenerate } from "../_shared/gemini-client.ts";

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
      // Will resolve userId from company owner after company_id is known
      userId = '';
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

    // Resolve userId for system/cron calls
    if (!userId) {
      const { data: ownerRow } = await supabaseService
        .from('company_users')
        .select('user_id')
        .eq('company_id', company_id)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();
      userId = ownerRow?.user_id || '00000000-0000-0000-0000-000000000000';
    }

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

    // Parse BMS data from quick_reference_info
    let bmsProducts = '';
    let bmsStockAlerts = '';
    let bmsSales = '';
    const qri = company.quick_reference_info || '';
    const bmsMatch = qri.match(/<!-- BMS_SYNC_START -->([\s\S]*?)<!-- BMS_SYNC_END -->/);
    if (bmsMatch) {
      const bmsBlock = bmsMatch[1];
      const prodMatch = bmsBlock.match(/## Products & Pricing([\s\S]*?)(?=##|$)/);
      const stockMatch = bmsBlock.match(/## Stock Alerts([\s\S]*?)(?=##|$)/);
      const salesMatch = bmsBlock.match(/## Sales Overview([\s\S]*?)(?=##|$)/);
      if (prodMatch) bmsProducts = prodMatch[1].trim();
      if (stockMatch) bmsStockAlerts = stockMatch[1].trim();
      if (salesMatch) bmsSales = salesMatch[1].trim();
    }

    // Choose content strategy based on available data
    const hasBmsData = !!(bmsProducts || bmsStockAlerts || bmsSales);
    const strategies = hasBmsData
      ? [
          bmsStockAlerts ? 'low_stock_urgency' : null,
          bmsProducts ? 'product_spotlight' : null,
          bmsSales ? 'bestseller_highlight' : null,
        ].filter(Boolean) as string[]
      : ['general_brand'];
    const strategy = strategies[Math.floor(Math.random() * strategies.length)];

    const strategyInstructions: Record<string, string> = {
      product_spotlight: 'Pick ONE specific product from the list. Mention its name and price. Make it the hero of the post.',
      low_stock_urgency: 'Focus on a LOW STOCK item. Create urgency — "Almost sold out!", "Only X left!", "Don\'t miss out!"',
      bestseller_highlight: 'Highlight a top-selling product from the sales data. Use social proof — "Our customers\' favorite!", "Best seller!"',
      general_brand: 'Create an engaging brand awareness post about the business and its services.',
    };

    // Build inventory context for the prompt
    const inventoryContext = hasBmsData ? `
AVAILABLE PRODUCTS:
${bmsProducts || 'N/A'}

${bmsStockAlerts ? `STOCK ALERTS:\n${bmsStockAlerts}\n` : ''}
${bmsSales ? `SALES TRENDS:\n${bmsSales}\n` : ''}

CONTENT STRATEGY: ${strategyInstructions[strategy]}
` : '';

    // 2. Brainstorm caption using AI
    const captionPrompt = `You are a world-class social media manager for "${company.name}" (${company.business_type || 'business'}).

Company info:
- Services: ${company.services || 'N/A'}
- Hours: ${company.hours || 'N/A'}
${ai?.system_instructions ? `- Brand voice: ${ai.system_instructions.substring(0, 500)}` : ''}
${imgSettings?.brand_tone ? `- Brand tone: ${imgSettings.brand_tone}` : ''}
${inventoryContext}
Create ONE highly engaging social media post caption for Facebook and Instagram. The caption should:
- Be authentic and engaging, not generic
- Include relevant emojis
- Have a clear call-to-action
${hasBmsData ? '- Reference a SPECIFIC product with its actual price\n- Create urgency for low-stock items if applicable' : ''}
- Be between 100-300 characters
- Feel natural, not AI-generated

Return ONLY the caption text, nothing else.`;

    const captionResponse = await geminiChat({
      model: 'glm-4.7',
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

    const { imageBase64, text: imageText } = await geminiImageGenerate({
      prompt: imagePrompt,
    });

    console.log('Image generation result:', imageBase64 ? 'got image' : 'no image', imageText?.substring(0, 50));

    let finalImageUrl: string | null = null;

    if (imageBase64) {
      // Extract base64 data and upload to storage
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
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
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
