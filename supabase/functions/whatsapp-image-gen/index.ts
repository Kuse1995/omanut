import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImageGenRequest {
  companyId: string;
  customerPhone: string;
  conversationId: string;
  prompt: string;
  messageType: 'generate' | 'feedback' | 'caption' | 'suggest';
  feedbackData?: {
    imageId?: string;
    rating?: number;
    feedbackType?: 'thumbs_up' | 'thumbs_down' | 'used' | 'shared';
  };
}

// Detect image generation commands from WhatsApp messages
export function detectImageGenCommand(message: string): { 
  isImageCommand: boolean; 
  type: 'generate' | 'feedback' | 'caption' | 'suggest' | null;
  prompt: string;
  feedbackData?: any;
} {
  const lowerMsg = message.toLowerCase().trim();
  
  // Generate image commands
  const generatePatterns = [
    /^(generate|create|make|design|draw)\s*(an?\s+)?(image|picture|photo|graphic|visual)\s*(of|for|with|showing)?\s*(.+)/i,
    /^image:\s*(.+)/i,
    /^img:\s*(.+)/i,
    /^🎨\s*(.+)/i,
    /^create\s*(.+)/i,
    /^generate\s*(.+)/i,
  ];
  
  for (const pattern of generatePatterns) {
    const match = message.match(pattern);
    if (match) {
      const prompt = match[match.length - 1]?.trim() || match[1]?.trim();
      if (prompt && prompt.length > 3) {
        return { isImageCommand: true, type: 'generate', prompt };
      }
    }
  }
  
  // Caption request
  if (lowerMsg.includes('caption') || lowerMsg.includes('what to post') || lowerMsg.includes('suggest text')) {
    return { isImageCommand: true, type: 'caption', prompt: message };
  }
  
  // Suggestion request
  if (lowerMsg.includes('what should i post') || lowerMsg.includes('post idea') || lowerMsg.includes('content idea') || lowerMsg.includes('suggest a post')) {
    return { isImageCommand: true, type: 'suggest', prompt: message };
  }
  
  // Feedback patterns
  if (lowerMsg.includes('👍') || lowerMsg.includes('love it') || lowerMsg.includes('great') || lowerMsg.includes('perfect')) {
    return { isImageCommand: true, type: 'feedback', prompt: message, feedbackData: { feedbackType: 'thumbs_up' } };
  }
  
  if (lowerMsg.includes('👎') || lowerMsg.includes('not good') || lowerMsg.includes('try again') || lowerMsg.includes('different')) {
    return { isImageCommand: true, type: 'feedback', prompt: message, feedbackData: { feedbackType: 'thumbs_down' } };
  }
  
  return { isImageCommand: false, type: null, prompt: '' };
}

// Build context from company media library
async function buildMediaContext(supabase: any, companyId: string): Promise<string> {
  // Fetch company media for style context
  const { data: media } = await supabase
    .from('company_media')
    .select('description, category, tags, file_path')
    .eq('company_id', companyId)
    .limit(20);
  
  // Fetch learned preferences
  const { data: settings } = await supabase
    .from('image_generation_settings')
    .select('*')
    .eq('company_id', companyId)
    .single();
  
  // Fetch high-rated images for style learning
  const { data: topImages } = await supabase
    .from('image_generation_feedback')
    .select('prompt, enhanced_prompt, learned_preferences')
    .eq('company_id', companyId)
    .gte('rating', 4)
    .order('created_at', { ascending: false })
    .limit(10);
  
  let context = '';
  
  if (settings?.business_context) {
    context += `Business Context: ${settings.business_context}\n`;
  }
  
  if (settings?.style_description) {
    context += `Preferred Style: ${settings.style_description}\n`;
  }
  
  if (settings?.learned_style_preferences && Object.keys(settings.learned_style_preferences).length > 0) {
    context += `Learned Preferences: ${JSON.stringify(settings.learned_style_preferences)}\n`;
  }
  
  if (media && media.length > 0) {
    context += `\nExisting Product Library (use as style reference):\n`;
    media.forEach((m: any) => {
      context += `- ${m.category}: ${m.description || 'No description'} [Tags: ${m.tags?.join(', ') || 'none'}]\n`;
    });
  }
  
  if (topImages && topImages.length > 0) {
    context += `\nTop Performing Prompts (replicate this style):\n`;
    topImages.forEach((img: any) => {
      context += `- "${img.prompt}"\n`;
    });
  }
  
  return context;
}

// Generate image using Lovable AI
async function generateImage(
  prompt: string, 
  context: string,
  companyName: string,
  businessType: string
): Promise<{ imageUrl: string; enhancedPrompt: string }> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  if (!LOVABLE_API_KEY) {
    throw new Error('LOVABLE_API_KEY not configured');
  }
  
  // Enhance prompt with context
  const enhancedPrompt = `${context}\n\nCreate a professional marketing image for ${companyName} (${businessType}): ${prompt}. Ultra high resolution, professional quality, suitable for social media marketing.`;
  
  console.log('[IMAGE-GEN] Enhanced prompt:', enhancedPrompt.substring(0, 200));
  
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image-preview',
      messages: [{ role: 'user', content: enhancedPrompt }],
      modalities: ['image', 'text']
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[IMAGE-GEN] Error:', response.status, errorText);
    
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again in a moment.');
    }
    if (response.status === 402) {
      throw new Error('AI credits exhausted. Please contact support.');
    }
    throw new Error('Failed to generate image');
  }
  
  const data = await response.json();
  const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  
  if (!imageUrl) {
    throw new Error('No image generated');
  }
  
  return { imageUrl, enhancedPrompt };
}

// Generate caption suggestion
async function generateCaption(
  imagePrompt: string,
  context: string,
  companyName: string
): Promise<{ caption: string; hashtags: string[]; bestTime: string }> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a social media marketing expert for ${companyName}. Generate engaging captions for product images. Respond in JSON format only.`
        },
        {
          role: 'user',
          content: `${context}\n\nGenerate a caption for this image: "${imagePrompt}"\n\nRespond with JSON: {"caption": "engaging caption text", "hashtags": ["tag1", "tag2"], "bestTime": "suggested posting time like 'Tuesday 2pm' or 'Weekend morning'"}`
        }
      ],
      temperature: 0.7
    })
  });
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  
  try {
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    return {
      caption: parsed.caption || 'Check out our latest product!',
      hashtags: parsed.hashtags || [],
      bestTime: parsed.bestTime || 'Weekday afternoon'
    };
  } catch {
    return {
      caption: 'Check out our amazing products! 🌟',
      hashtags: ['products', 'business'],
      bestTime: 'Weekday afternoon'
    };
  }
}

// Generate content suggestions
async function generateSuggestions(
  context: string,
  companyName: string,
  businessType: string
): Promise<{ suggestions: string[] }> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a creative marketing strategist for ${companyName}, a ${businessType}. Suggest compelling product image ideas.`
        },
        {
          role: 'user',
          content: `${context}\n\nSuggest 3 creative image ideas I should create for social media. Be specific about composition, mood, and what to highlight. Format as a numbered list.`
        }
      ],
      temperature: 0.8
    })
  });
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  const suggestions = content
    .split(/\n/)
    .filter((line: string) => line.match(/^\d+\./))
    .map((line: string) => line.replace(/^\d+\.\s*/, '').trim())
    .slice(0, 3);
  
  return { suggestions: suggestions.length > 0 ? suggestions : ['Product showcase with lifestyle setting', 'Behind-the-scenes content', 'Customer testimonial visual'] };
}

// Process feedback and update learning
async function processFeedback(
  supabase: any,
  companyId: string,
  feedbackType: string,
  lastImageId?: string
): Promise<string> {
  // Get most recent generated image if no ID provided
  let imageId = lastImageId;
  let imageData = null;
  
  if (!imageId) {
    const { data: recentImage } = await supabase
      .from('generated_images')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (recentImage) {
      imageId = recentImage.id;
      imageData = recentImage;
    }
  } else {
    const { data } = await supabase
      .from('generated_images')
      .select('*')
      .eq('id', imageId)
      .single();
    imageData = data;
  }
  
  if (!imageData) {
    return "No recent image found to rate.";
  }
  
  // Record feedback
  const rating = feedbackType === 'thumbs_up' ? 5 : feedbackType === 'thumbs_down' ? 1 : 3;
  
  await supabase.from('image_generation_feedback').insert({
    company_id: companyId,
    generated_image_id: imageId,
    prompt: imageData.prompt,
    image_url: imageData.image_url,
    rating,
    feedback_type: feedbackType
  });
  
  // Update learned preferences if positive feedback
  if (feedbackType === 'thumbs_up') {
    const { data: settings } = await supabase
      .from('image_generation_settings')
      .select('top_performing_prompts')
      .eq('company_id', companyId)
      .single();
    
    const topPrompts = settings?.top_performing_prompts || [];
    if (!topPrompts.includes(imageData.prompt)) {
      topPrompts.unshift(imageData.prompt);
      const updatedPrompts = topPrompts.slice(0, 10); // Keep top 10
      
      await supabase
        .from('image_generation_settings')
        .update({ top_performing_prompts: updatedPrompts })
        .eq('company_id', companyId);
    }
    
    return "Great! I've noted that you liked this style. I'll create more images like this in the future! 🎨✨";
  } else {
    return "Got it! I'll try a different approach next time. What would you like to see instead?";
  }
}

// Send image via WhatsApp
async function sendWhatsAppImage(
  customerPhone: string,
  imageUrl: string,
  caption: string,
  company: any
): Promise<boolean> {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !company.whatsapp_number) {
    console.log('[IMAGE-GEN] No Twilio config for sending image');
    return false;
  }
  
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
    ? company.whatsapp_number 
    : `whatsapp:${company.whatsapp_number}`;
  
  const formData = new URLSearchParams();
  formData.append('From', fromNumber);
  formData.append('To', `whatsapp:${customerPhone}`);
  formData.append('Body', caption);
  formData.append('MediaUrl', imageUrl);
  
  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });
  
  return response.ok;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { companyId, customerPhone, conversationId, prompt, messageType, feedbackData } = await req.json() as ImageGenRequest;

    console.log(`[IMAGE-GEN] Request: type=${messageType}, company=${companyId}, prompt="${prompt?.substring(0, 50)}..."`);

    // Fetch company info
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (!company) {
      throw new Error('Company not found');
    }

    // Check if image generation is enabled
    const { data: settings } = await supabase
      .from('image_generation_settings')
      .select('enabled')
      .eq('company_id', companyId)
      .single();

    if (!settings?.enabled) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Image generation is not enabled for this business. Please contact your administrator." 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build context from media library
    const context = await buildMediaContext(supabase, companyId);
    let responseMessage = '';
    let imageUrl = '';

    switch (messageType) {
      case 'generate': {
        const result = await generateImage(prompt, context, company.name, company.business_type || 'business');
        imageUrl = result.imageUrl;
        
        // Save to generated_images
        const { data: savedImage } = await supabase
          .from('generated_images')
          .insert({
            company_id: companyId,
            conversation_id: conversationId,
            prompt,
            image_url: imageUrl
          })
          .select()
          .single();
        
        // Generate caption suggestion
        const captionResult = await generateCaption(prompt, context, company.name);
        
        // Record for learning (initial)
        await supabase.from('image_generation_feedback').insert({
          company_id: companyId,
          generated_image_id: savedImage?.id,
          prompt,
          enhanced_prompt: result.enhancedPrompt,
          image_url: imageUrl,
          caption_suggestion: captionResult.caption,
          posting_time_suggestion: null // Will be updated if they use it
        });
        
        responseMessage = `🎨 Here's your image!\n\n📝 *Suggested Caption:*\n${captionResult.caption}\n\n#️⃣ *Hashtags:* ${captionResult.hashtags.map(h => `#${h}`).join(' ')}\n\n⏰ *Best time to post:* ${captionResult.bestTime}\n\nReply 👍 if you like it or 👎 for a different style!`;
        
        // Send image via WhatsApp
        if (customerPhone) {
          await sendWhatsAppImage(customerPhone, imageUrl, responseMessage, company);
        }
        break;
      }
      
      case 'caption': {
        const captionResult = await generateCaption(prompt, context, company.name);
        responseMessage = `📝 *Caption Suggestion:*\n${captionResult.caption}\n\n#️⃣ *Hashtags:* ${captionResult.hashtags.map(h => `#${h}`).join(' ')}\n\n⏰ *Best time to post:* ${captionResult.bestTime}`;
        break;
      }
      
      case 'suggest': {
        const suggestions = await generateSuggestions(context, company.name, company.business_type || 'business');
        responseMessage = `💡 *Content Ideas for Today:*\n\n${suggestions.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n\n')}\n\nWant me to create any of these? Just say "Generate: [idea]" 🎨`;
        break;
      }
      
      case 'feedback': {
        responseMessage = await processFeedback(
          supabase, 
          companyId, 
          feedbackData?.feedbackType || 'thumbs_up',
          feedbackData?.imageId
        );
        break;
      }
    }

    // Store AI response in messages
    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: responseMessage,
        message_metadata: imageUrl ? { generated_image_url: imageUrl } : {}
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: responseMessage,
        imageUrl: imageUrl || null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[IMAGE-GEN] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
