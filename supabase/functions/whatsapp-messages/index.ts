import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.21.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const KIMI_API_KEY = Deno.env.get('KIMI_API_KEY');
    if (!KIMI_API_KEY) {
      throw new Error('KIMI_API_KEY is not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse Twilio WhatsApp webhook payload
    const formData = await req.formData();
    const From = formData.get('From') as string; // User's WhatsApp number
    const To = formData.get('To') as string; // Business WhatsApp number
    const Body = formData.get('Body') as string || ''; // Message text
    
    // Extract media information from Twilio webhook
    const NumMedia = parseInt(formData.get('NumMedia') as string || '0');
    const mediaFiles: Array<{ url: string; contentType: string }> = [];
    
    for (let i = 0; i < NumMedia; i++) {
      const mediaUrl = formData.get(`MediaUrl${i}`) as string;
      const mediaContentType = formData.get(`MediaContentType${i}`) as string;
      if (mediaUrl && mediaContentType) {
        mediaFiles.push({ url: mediaUrl, contentType: mediaContentType });
      }
    }

    // Validate input
    const messageSchema = z.object({
      From: z.string().min(1).max(255),
      To: z.string().min(1).max(255),
      Body: z.string().max(4096)
    });

    try {
      messageSchema.parse({ From, To, Body });
    } catch (error) {
      console.error('Invalid input:', error);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Invalid message format.]]></Message>
</Response>`, {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    console.log('WhatsApp message received:', { From, To, Body });

    // Look up company by WhatsApp number
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*, metadata')
      .eq('whatsapp_number', To)
      .maybeSingle();

    if (companyError) {
      console.error('Database error looking up company:', companyError);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Our service is temporarily unavailable. Please try again later.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    if (!company) {
      console.error('Company not found for WhatsApp number:', To);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[This WhatsApp number is not configured. Please contact support.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Check if this message is from the boss
    // Normalize phone numbers for comparison (remove whatsapp: prefix and handle various formats)
    const normalizePhone = (phone: string) => {
      return phone.replace(/^whatsapp:/i, '').replace(/\+/g, '').replace(/\s/g, '');
    };
    
    const fromPhone = normalizePhone(From);
    const bossPhone = company.boss_phone ? normalizePhone(company.boss_phone) : '';
    
    console.log('Phone comparison:', { fromPhone, bossPhone, isBoss: fromPhone === bossPhone });
    
    if (company.boss_phone && fromPhone === bossPhone) {
      console.log('Message from BOSS detected - handling internally');
      
      // Get boss conversation context
      const { data: aiOverrides } = await supabase
        .from('company_ai_overrides')
        .select('*')
        .eq('company_id', company.id)
        .maybeSingle();

      const { data: documents } = await supabase
        .from('company_documents')
        .select('parsed_content')
        .eq('company_id', company.id)
        .not('parsed_content', 'is', null);

      const { data: recentConvs } = await supabase
        .from('conversations')
        .select('customer_name, phone, status, quality_flag, started_at')
        .eq('company_id', company.id)
        .order('started_at', { ascending: false })
        .limit(10);

      const { data: recentReservations } = await supabase
        .from('reservations')
        .select('*')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: actionItems } = await supabase
        .from('action_items')
        .select('*')
        .eq('company_id', company.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: clientInfo } = await supabase
        .from('client_information')
        .select('*')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const knowledgeBase = documents?.map((doc: any) => doc.parsed_content).filter(Boolean).join('\n\n') || '';

      const systemPrompt = `You are the internal AI assistant for ${company.name}. You're speaking with the OWNER/MANAGEMENT, not a customer.

IMPORTANT: Be direct, professional, and treat them as part of the business team. Don't pitch services - they own the business! Provide business intelligence and operational insights.

BUSINESS INFO:
Type: ${company.business_type}
Hours: ${company.hours}
Services: ${company.services}
${aiOverrides?.system_instructions ? `\nInternal Notes: ${aiOverrides.system_instructions}` : ''}

CURRENT OPERATIONS:
Recent Conversations (${recentConvs?.length || 0}):
${recentConvs?.map((c: any) => `• ${c.customer_name || 'Unknown'} (${c.phone}): ${c.status}${c.quality_flag ? ` - ${c.quality_flag}` : ''}`).join('\n') || 'None yet'}

Reservations (${recentReservations?.length || 0}):
${recentReservations?.map((r: any) => `• ${r.name} - ${r.guests} guests on ${r.date} at ${r.time} (${r.status})`).join('\n') || 'None yet'}

Pending Actions (${actionItems?.length || 0}):
${actionItems?.map((a: any) => `• [${a.priority}] ${a.action_type}: ${a.description}`).join('\n') || 'No pending actions'}

Client Intelligence (${clientInfo?.length || 0}):
${clientInfo?.map((i: any) => `• ${i.customer_name}: ${i.information}`).join('\n') || 'No insights yet'}

${knowledgeBase ? `\nKNOWLEDGE BASE:\n${knowledgeBase}` : ''}

Respond as their business assistant. Be concise, actionable, and focus on operational insights.`;

      
      const managementResponse = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIMI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'moonshot-v1-32k',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: Body }
          ],
          temperature: 0.3,
          max_tokens: 800
        }),
      });

      if (!managementResponse.ok) {
        console.error('AI error for boss:', await managementResponse.text());
        throw new Error('AI service error');
      }

      const managementData = await managementResponse.json();
      const aiResponse = managementData.choices[0].message.content;

      console.log('BOSS response generated:', aiResponse.substring(0, 100));

      // Log boss conversation
      await supabase.from('boss_conversations').insert({
        company_id: company.id,
        message_from: 'boss',
        message_content: Body,
        response: aiResponse
      });

      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${aiResponse}</Message>
</Response>`, {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    // Check credit balance
    if (company.credit_balance <= 0) {
      const offlineMessage = "Our assistant is currently offline. A human will message you shortly.";
      
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${offlineMessage}]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Extract phone number from WhatsApp format (remove "whatsapp:" prefix)
    const customerPhone = From.replace('whatsapp:', '');
    
    // Find or create active conversation
    let { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('company_id', company.id)
      .eq('phone', From)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Check if conversation is in human takeover mode
    if (conversation && conversation.human_takeover) {
      console.log('Conversation is in human takeover mode, storing message only');
      
      // Insert user message
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'user',
          content: Body
        });
      
      // Don't respond, human will handle it
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    if (convError || !conversation) {
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          company_id: company.id,
          phone: From,
          status: 'active',
          transcript: `CUSTOMER PHONE: ${customerPhone}\n`
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating conversation:', createError);
        throw createError;
      }
      conversation = newConv;
    }

    // Deduct credits for WhatsApp message
    await supabase.rpc('deduct_credits', {
      p_company_id: company.id,
      p_amount: 1,
      p_reason: 'whatsapp_message',
      p_conversation_id: conversation.id
    });
    
    // Download and store media files if present
    const storedMediaUrls: string[] = [];
    const storedMediaTypes: string[] = [];
    
    if (mediaFiles.length > 0) {
      console.log(`Processing ${mediaFiles.length} media files`);
      
      for (let i = 0; i < mediaFiles.length; i++) {
        const media = mediaFiles[i];
        try {
          // Download media from Twilio URL
          const mediaResponse = await fetch(media.url);
          if (!mediaResponse.ok) {
            console.error(`Failed to download media ${i}: ${mediaResponse.status}`);
            continue;
          }
          
          const mediaBlob = await mediaResponse.arrayBuffer();
          const fileExt = media.contentType.split('/')[1] || 'bin';
          const fileName = `${conversation.id}/${Date.now()}_${i}.${fileExt}`;
          
          // Upload to Supabase Storage
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('conversation-media')
            .upload(fileName, mediaBlob, {
              contentType: media.contentType,
              upsert: false
            });
          
          if (uploadError) {
            console.error(`Failed to upload media ${i}:`, uploadError);
            continue;
          }
          
          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('conversation-media')
            .getPublicUrl(fileName);
          
          storedMediaUrls.push(publicUrl);
          storedMediaTypes.push(media.contentType);
          
          console.log(`Successfully stored media ${i}: ${publicUrl}`);
        } catch (error) {
          console.error(`Error processing media ${i}:`, error);
        }
      }
    }

    // Fetch AI overrides
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company.id)
      .single();

    // Get company documents for knowledge base
    const { data: documents } = await supabase
      .from('company_documents')
      .select('filename, parsed_content')
      .eq('company_id', company.id)
      .not('parsed_content', 'is', null);

    // Get company media library
    const { data: mediaLibrary } = await supabase
      .from('company_media')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false });

    // Get payment products for the company
    const { data: products } = await supabase
      .from('payment_products')
      .select('*')
      .eq('company_id', company.id)
      .eq('is_active', true)
      .order('price', { ascending: true });

    // Build knowledge base from documents
    let knowledgeBase = '';
    if (documents && documents.length > 0) {
      knowledgeBase = '\n\n📚 COMPANY KNOWLEDGE BASE (Use this to answer customer questions):\n';
      documents.forEach(doc => {
        if (doc.parsed_content) {
          knowledgeBase += `\n--- ${doc.filename} ---\n${doc.parsed_content}\n`;
        }
      });
      knowledgeBase += '\nWhen customers ask questions, check this knowledge base FIRST for accurate information.\n';
    }

    // Build categorized media library context
    let mediaContext = '';
    if (mediaLibrary && mediaLibrary.length > 0) {
      // Group media by category
      const categorizedMedia: Record<string, any[]> = {};
      mediaLibrary.forEach((media: any) => {
        const category = media.category || 'other';
        if (!categorizedMedia[category]) {
          categorizedMedia[category] = [];
        }
        categorizedMedia[category].push(media);
      });

      const categoryLabels: Record<string, string> = {
        'menu': '📋 MENU',
        'interior': '🏢 INTERIOR',
        'exterior': '🏛️ EXTERIOR',
        'logo': '🎨 LOGO',
        'products': '📦 PRODUCTS',
        'promotional': '🎉 PROMOTIONAL',
        'staff': '👥 STAFF',
        'events': '🎊 EVENTS',
        'facilities': '🏊 FACILITIES',
        'other': '📁 OTHER'
      };

      mediaContext = '\n\n🖼️ AVAILABLE MEDIA LIBRARY (organized by category):\n';
      
      Object.entries(categorizedMedia).forEach(([category, items]) => {
        const label = categoryLabels[category] || category.toUpperCase();
        mediaContext += `\n${label} (${items.length} file${items.length > 1 ? 's' : ''}):\n`;
        
        items.forEach((media: any) => {
          const url = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/company-media/${media.file_path}`;
          mediaContext += `- ${media.media_type.toUpperCase()}: "${media.file_name}"`;
          if (media.description) mediaContext += ` - ${media.description}`;
          if (media.tags && media.tags.length > 0) mediaContext += ` (Tags: ${media.tags.join(', ')})`;
          mediaContext += `\n  URL: ${url}\n`;
        });
      });
      
      mediaContext += '\n📌 MEDIA SELECTION GUIDE:\n';
      mediaContext += '- Menu requests ("show menu", "what food") → Use MENU category\n';
      mediaContext += '- Venue appearance ("show your place", "how it looks") → Use INTERIOR or EXTERIOR\n';
      mediaContext += '- Logo/branding requests → Use LOGO category\n';
      mediaContext += '- Product inquiries → Use PRODUCTS category\n';
      mediaContext += '- Promotional offers/specials → Use PROMOTIONAL category\n';
      mediaContext += '- Staff/team requests → Use STAFF category\n';
      mediaContext += '- Event photos → Use EVENTS category\n';
      mediaContext += '- Amenities (pool, gym, etc.) → Use FACILITIES category\n';
      mediaContext += '\n⚠️ CRITICAL: When customer requests media:\n';
      mediaContext += '1. NEVER include media URLs in your text response\n';
      mediaContext += '2. ALWAYS call send_media() tool to send images/videos directly\n';
      mediaContext += '3. In your text, simply acknowledge: "Let me send that to you now!" then call send_media()\n';
      mediaContext += '4. The media will be sent automatically as attachments via WhatsApp\n';
      mediaContext += '5. For galleries/collections ("show me all", "send pictures of", "all your photos"), send multiple media by including multiple URLs\n';
      mediaContext += '\nAlways match customer intent to the most relevant category, then select the best media from that category.\n';
    }

    // Build products/services catalog
    let productsContext = '';
    if (products && products.length > 0) {
      productsContext = '\n\n💳 AVAILABLE SERVICES & PRICING:\n\n';
      products.forEach((product: any) => {
        productsContext += `Product ID: ${product.id}\n`;
        productsContext += `${product.name} - ${product.currency}${product.price}\n`;
        if (product.description) {
          productsContext += `  ${product.description}\n`;
        }
        if (product.duration_minutes) {
          productsContext += `  Duration: ${product.duration_minutes} minutes\n`;
        }
        productsContext += '\n';
      });
      
      productsContext += `📋 PAYMENT FLOW:\n`;
      productsContext += `When customer asks about pricing or wants to order:\n`;
      productsContext += `1. Share the relevant product prices from the list above\n`;
      productsContext += `2. If they want to order, collect: product choice, any special requirements\n`;
      productsContext += `3. Ask their payment preference: "Would you like to pay via Mobile Money (MTN, Airtel, Zamtel) or International card?"\n`;
      productsContext += `4. Once confirmed, call request_payment() with the EXACT Product ID from the list above, product name, amount, and payment method\n`;
      productsContext += `5. After payment link is sent, tell them: "I've sent you the payment link/instructions. Once payment is confirmed, our team will start working on your project immediately!"\n\n`;
      productsContext += `CRITICAL: When calling request_payment(), you MUST use the exact Product ID (UUID) shown above for the product. Do not make up or guess IDs!\n\n`;
      productsContext += `Payment methods available:\n`;
      productsContext += `✅ Mobile Money (MTN, Airtel, Zamtel) - For Zambian customers (instant USSD prompt)\n`;
      productsContext += `✅ International Cards (via Selar) - For anyone worldwide\n\n`;
    }

    // Build comprehensive instructions
    let dynamicInfo = '';
    if (company.metadata && Object.keys(company.metadata).length > 0) {
      dynamicInfo = `\n\nREAL-TIME INFORMATION (Use this current data when answering):\n${JSON.stringify(company.metadata, null, 2)}`;
    }

    // Add quick reference info if available
    let quickRefInfo = '';
    if (company.quick_reference_info && company.quick_reference_info.trim()) {
      quickRefInfo = `\n\nQUICK REFERENCE INFO:\n${company.quick_reference_info}\n`;
    }

    // Get current date for AI context
    const today = new Date();
    const currentDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format
    const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });
    
    // Industry-specific configurations
    const industryPrompts: Record<string, { location_prompt: string; confirmation: string }> = {
      restaurant: {
        location_prompt: "Which area would you prefer - poolside, outdoor terrace, or indoor dining?",
        confirmation: "booking for {guests} guests on {date} at {time} in the {location} area"
      },
      clinic: {
        location_prompt: "Which department do you need - general consultation, pediatrics, or specialist?",
        confirmation: "appointment on {date} at {time} in the {location} department"
      },
      gym: {
        location_prompt: "Which area would you like to use - main gym floor, yoga studio, or outdoor training area?",
        confirmation: "session on {date} at {time} in the {location}"
      },
      salon: {
        location_prompt: "Would you prefer the main salon area or our private VIP room?",
        confirmation: "appointment for your service on {date} at {time}"
      },
      hotel: {
        location_prompt: "Which facility would you like to book - restaurant, spa, or conference room?",
        confirmation: "reservation on {date} at {time} at our {location}"
      },
      spa: {
        location_prompt: "Would you like a regular treatment room or our VIP suite?",
        confirmation: "appointment for your service on {date} at {time}"
      }
    };

    const businessPrompt = industryPrompts[company.business_type] || {
      location_prompt: "Which location would you prefer?",
      confirmation: "appointment on {date} at {time}"
    };
    
    const instructions = `You are the receptionist for ${company.name} in Zambia.
Business type: ${company.business_type}.
Voice style: ${company.voice_style}.
Business hours: ${company.hours}.
Locations / branches: ${company.branches}.
Services offered: ${company.services}.
Service locations available: ${company.service_locations}.
Currency: always use ${company.currency_prefix} (Kwacha).
Your job is to answer messages, help politely, create/record bookings or appointments, and process service orders/payments.

CRITICAL DATE INFORMATION:
- Today's date is: ${currentDate} (${dayOfWeek})
- When customers say "today", "tomorrow", or "next week", calculate the correct date based on ${currentDate}
- ALWAYS use dates in YYYY-MM-DD format
- If a customer says "tomorrow", add 1 day to ${currentDate}
- If a customer mentions "next Monday", calculate from ${currentDate}

${quickRefInfo}
${knowledgeBase}
${mediaContext}
${productsContext}
IMPORTANT: The customer is messaging from WhatsApp number ${customerPhone}. This is their contact number - you already have it. DO NOT ask for their phone number again.

${dynamicInfo}

${aiOverrides?.system_instructions || ''}

Answer style:
${aiOverrides?.qa_style || ''}

Do NOT talk about:
${aiOverrides?.banned_topics || ''}

Critical rules:

1. CUSTOMER PHONE: ${customerPhone} - You ALREADY HAVE this. Never ask for it again.

2. MEDIA SENDING - CRITICAL: When customers ask for samples, portfolio, videos, photos, images, examples of your work, gallery, or say "show me", "send me", "share", "can I see", "what have you made" - you MUST call the send_media tool. NEVER just say you'll send something - actually call the tool! Look in the Media Library section above for available media URLs.

3. When answering questions, ALWAYS check the Company Knowledge Base first for accurate information.

4. When taking a booking, you only need to ask for:
   - Their NAME (ask once: "May I have your name please?")
   - DATE and TIME of booking
   - NUMBER OF GUESTS
   - WHICH BRANCH (if multiple locations) - Example: "${businessPrompt.location_prompt}"
   - LOCATION PREFERENCE (if applicable)
   
5. NEVER ask for the same information twice. Once they give you their name, use it in the conversation.

6. Before creating a reservation, confirm ALL details ONCE using this format:
   "Perfect! Let me confirm: [NAME], ${customerPhone}, ${businessPrompt.confirmation.replace('{guests}', '[GUESTS]').replace('{date}', '[DATE]').replace('{time}', '[TIME]').replace('{location}', '[LOCATION]')}. Is that correct?"
   Only call create_reservation after they confirm.

7. Track what information you already have. Look at the conversation history to see what they've told you.

8. Be concise and natural. Don't sound like a robot repeating questions.

9. Always speak in warm, respectful Zambian English.

10. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.`;

    // Build conversation history - keep full context to avoid repetition
    const transcriptLines = conversation.transcript.split('\n').filter((line: string) => line.trim());
    const recentHistory = transcriptLines.join('\n');

    const messages = [
      { role: 'system', content: instructions }
    ];

    if (recentHistory) {
      messages.push({ role: 'assistant', content: `Previous conversation context:\n${recentHistory}` });
    }

    messages.push({ role: 'user', content: Body });

    // Call Kimi AI
    
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshot-v1-32k',
        messages,
        temperature: 0.3,
        tools: [
          {
            type: "function",
            function: {
              name: "create_reservation",
              description: "Create a booking ONLY after confirming all details with the customer. Never assume or invent information.",
              parameters: {
                type: "object",
                properties: {
                  name: { 
                    type: "string", 
                    description: "Customer's actual full name as they provided it. Do not use placeholders." 
                  },
                  phone: { 
                    type: "string", 
                    description: "Customer's actual phone number exactly as spoken. Include country code or leading 0. Repeat back to confirm." 
                  },
                  date: { 
                    type: "string", 
                    description: "Exact date requested by customer in YYYY-MM-DD format" 
                  },
                  time: { 
                    type: "string", 
                    description: "Exact time requested by customer in HH:MM 24-hour format" 
                  },
                  guests: { 
                    type: "number", 
                    description: "Exact number of guests the customer specified" 
                  },
                  occasion: { 
                    type: "string", 
                    description: "The specific occasion or reason for booking as stated by customer. Ask if not mentioned." 
                  },
                  area_preference: { 
                    type: "string", 
                    description: "REQUIRED: The specific area or seating preference the customer wants. Ask if not mentioned." 
                  },
                  branch: { 
                    type: "string", 
                    description: "REQUIRED: Which specific branch or location the customer wants to book at. Ask if not mentioned." 
                  },
                  email: { 
                    type: "string", 
                    description: "Customer's email address ONLY if they volunteer it." 
                  }
                },
                required: ["name", "phone", "date", "time", "guests", "area_preference", "branch"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "send_media",
              description: "MANDATORY USE: Call this tool immediately when customer uses ANY of these keywords or phrases: 'samples', 'portfolio', 'videos', 'photos', 'images', 'examples', 'what you made', 'what you've made', 'show me', 'send me', 'share', 'can I see', 'I would like to see', 'gallery', 'your work'. Send actual media files to WhatsApp (NOT text descriptions or promises). Match the media category: 'logo' for logos, 'products' for product samples, 'promotional' for marketing content, 'menu' for menus, 'interior/exterior' for venue photos. NEVER say 'let me send' or 'I'll share' - just call this tool directly.",
              parameters: {
                type: "object",
                properties: {
                  media_urls: {
                    type: "array",
                    items: {
                      type: "string"
                    },
                    description: "Array of complete URLs of relevant media files from the library. Use single URL for individual requests, multiple URLs for galleries/collections."
                  },
                  caption: {
                    type: "string",
                    description: "A friendly, contextual caption explaining what the media shows (will be sent with the first media attachment)"
                  },
                  category: {
                    type: "string",
                    description: "Category of media being sent (menu, interior, exterior, logo, products, promotional, staff, events, facilities, other) - for tracking purposes"
                  }
                },
                required: ["media_urls", "category"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "request_payment",
              description: "Send a payment link when customer wants to pay for a service. Match their request to available products. Ask for payment method preference if not specified (mobile money or international card).",
              parameters: {
                type: "object",
                properties: {
                  product_id: {
                    type: "string",
                    description: "UUID of the product/service the customer wants"
                  },
                  product_name: {
                    type: "string",
                    description: "Name of the product for context"
                  },
                  amount: {
                    type: "number",
                    description: "Amount to be paid"
                  },
                  payment_method: {
                    type: "string",
                    enum: ["selar", "mtn", "airtel", "zamtel"],
                    description: "Customer's preferred payment method. If customer is in Zambia, suggest mobile money. If international or unspecified, use selar."
                  },
                  customer_details: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      email: { type: "string" }
                    },
                    description: "Additional customer details if collected"
                  }
                },
                required: ["product_id", "product_name", "amount", "payment_method"]
              }
            }
          }
        ],
        tool_choice: "auto"
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Kimi AI error:', response.status, errorText);
      throw new Error(`Kimi AI error: ${response.status}`);
    }

    const aiData = await response.json();
    let assistantReply = aiData.choices[0].message.content || '';
    const toolCalls = aiData.choices[0].message.tool_calls;

    console.log('AI response:', { assistantReply, toolCalls });
    console.log('AI response full message:', JSON.stringify(aiData.choices[0].message, null, 2));

    // Track successful tool executions for contextual response generation
    const toolExecutionContext: string[] = [];
    let anyToolExecuted = false;

    // Handle tool calls (reservation creation, media sending, and payment requests)
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'request_payment') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('AI requesting payment:', args);
          
          try {
            // Notify management about payment request
            await supabase.functions.invoke('send-boss-notification', {
              body: {
                companyId: company.id,
                notificationType: 'payment_request',
                data: {
                  customer_name: conversation.customer_name || args.customer_details?.name || 'Unknown',
                  customer_phone: From,
                  customer_email: args.customer_details?.email,
                  product_name: args.product_name,
                  amount: args.amount,
                  currency_prefix: company.currency_prefix,
                  payment_method: args.payment_method
                }
              }
            });
            
            anyToolExecuted = true;
            toolExecutionContext.push(`notified management about payment request for ${args.product_name}`);
            
            // Inform customer that management will contact them
            assistantReply = `Thank you for your interest in *${args.product_name}*! Our team has been notified about your payment request and will contact you shortly with payment instructions. You should hear from us within a few hours. 📱`;
            
            console.log('Management notified about payment request');
          } catch (paymentError) {
            console.error('Error processing payment request:', paymentError);
            assistantReply += "\n\nI encountered an error processing your payment request. Please try again or contact us directly.";
          }
        } else if (toolCall.function.name === 'send_media') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('AI wants to send media:', args);
          
          // Send media directly via Twilio
          const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
          const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
          
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            try {
              const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
              const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
                ? company.whatsapp_number 
                : `whatsapp:${company.whatsapp_number}`;
              
              // Support both single media_url (legacy) and multiple media_urls (new)
              const mediaUrls = args.media_urls || (args.media_url ? [args.media_url] : []);
              
              if (mediaUrls.length === 0) {
                console.error('No media URLs provided');
                assistantReply = "I couldn't find the media to send.";
              } else {
                // Generate signed URLs for all media files (valid for 1 hour)
                const signedMediaUrls: string[] = [];
                
                for (const mediaUrl of mediaUrls) {
                  try {
                    // Extract file path from Supabase storage URL
                    // URL format: https://<project>.supabase.co/storage/v1/object/company-media/<file-path>
                    const urlParts = mediaUrl.split('/storage/v1/object/');
                    if (urlParts.length === 2) {
                      const pathWithBucket = urlParts[1];
                      // Remove bucket name and any public prefix to get just the file path
                      const filePath = pathWithBucket.replace('company-media/', '').replace('public/', '');
                      
                      console.log('Generating signed URL for path:', filePath);
                      
                      // Generate signed URL valid for 1 hour
                      const { data: signedData, error: signError } = await supabase
                        .storage
                        .from('company-media')
                        .createSignedUrl(filePath, 3600);
                      
                      if (signError) {
                        console.error('Error generating signed URL:', signError);
                        signedMediaUrls.push(mediaUrl); // Fallback to original URL
                      } else if (signedData?.signedUrl) {
                        console.log('Generated signed URL successfully');
                        signedMediaUrls.push(signedData.signedUrl);
                      } else {
                        console.error('No signed URL returned');
                        signedMediaUrls.push(mediaUrl);
                      }
                    } else {
                      console.error('Could not parse storage URL:', mediaUrl);
                      signedMediaUrls.push(mediaUrl);
                    }
                  } catch (urlError) {
                    console.error('Error processing media URL:', urlError);
                    signedMediaUrls.push(mediaUrl);
                  }
                }
                
                let successCount = 0;
                let failCount = 0;
                
                // Construct StatusCallback URL for delivery tracking
                const statusCallbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-status-webhook`;
                
                // Send each media file as a separate message using signed URLs
                for (let i = 0; i < signedMediaUrls.length; i++) {
                  const signedUrl = signedMediaUrls[i];
                  const originalUrl = args.media_urls[i];
                  const formData = new URLSearchParams();
                  formData.append('From', fromNumber);
                  formData.append('To', From);
                  formData.append('StatusCallback', statusCallbackUrl);
                  
                  // Add caption only to the first message
                  if (i === 0 && args.caption) {
                    formData.append('Body', args.caption);
                  } else if (signedMediaUrls.length > 1) {
                    formData.append('Body', `${i + 1}/${signedMediaUrls.length}`);
                  } else {
                    formData.append('Body', 'Here you go!');
                  }
                  
                  formData.append('MediaUrl', signedUrl);

                  const twilioResponse = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                      'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                      'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: formData.toString(),
                  });

                  if (twilioResponse.ok) {
                    successCount++;
                    console.log(`Media ${i + 1}/${signedMediaUrls.length} sent successfully`);
                    
                    // Parse Twilio response to get MessageSid
                    try {
                      const twilioData = await twilioResponse.json();
                      const messageSid = twilioData.sid;
                      
                      // Log to media_delivery_status table
                      await supabase.from('media_delivery_status').insert({
                        company_id: company.id,
                        conversation_id: conversation.id,
                        customer_phone: customerPhone,
                        media_url: originalUrl,
                        twilio_message_sid: messageSid,
                        status: 'queued'
                      });
                      
                      console.log(`Logged media delivery: ${messageSid}`);
                    } catch (logError) {
                      console.error('Error logging media delivery:', logError);
                      // Don't fail the whole operation if logging fails
                    }
                  } else {
                    failCount++;
                    const errorText = await twilioResponse.text();
                    console.error(`Twilio API error sending media ${i + 1}:`, twilioResponse.status, errorText);
                  }
                  
                  // Small delay between messages to avoid rate limiting
                  if (i < signedMediaUrls.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                  }
                }
                
                // Log the media send in messages table
                await supabase
                  .from('messages')
                  .insert({
                    conversation_id: conversation.id,
                    role: 'assistant',
                    content: `[Sent ${signedMediaUrls.length} ${args.category} media file${signedMediaUrls.length > 1 ? 's' : ''}]${args.caption ? ' - ' + args.caption : ''}`
                  });
                
                // Set appropriate response based on results
                if (successCount === signedMediaUrls.length) {
                  // Track successful media send for contextual response
                  anyToolExecuted = true;
                  toolExecutionContext.push(`sent ${signedMediaUrls.length} ${args.category} media file${signedMediaUrls.length > 1 ? 's' : ''}`);
                  console.log(`All ${signedMediaUrls.length} media files sent successfully`);
                } else if (successCount > 0) {
                  anyToolExecuted = true;
                  assistantReply = `I sent ${successCount} out of ${signedMediaUrls.length} media files. Some failed to send.`;
                } else {
                  assistantReply = "I tried to send the media but encountered an issue. Let me try again or I can help you another way.";
                }
              }
            } catch (twilioError) {
              console.error('Error sending media via Twilio:', twilioError);
              assistantReply = "I tried to send you the media but encountered an error.";
            }
          } else {
            console.error('Twilio credentials not configured for media sending');
            assistantReply = "I'm unable to send media at the moment. Please contact us directly.";
          }
        } else if (toolCall.function.name === 'create_reservation') {
          const args = JSON.parse(toolCall.function.arguments);
          
          // Use WhatsApp phone number if not provided in args
          const reservationPhone = args.phone || customerPhone;
          
          // Insert reservation
          const { error: resError } = await supabase
            .from('reservations')
            .insert({
              company_id: company.id,
              conversation_id: conversation.id,
              name: args.name,
              phone: reservationPhone,
              email: args.email || null,
              date: args.date,
              time: args.time,
              guests: args.guests,
              occasion: args.occasion || null,
              area_preference: args.area_preference,
              branch: args.branch,
              status: 'confirmed'
            });

          if (resError) {
            console.error('Error creating reservation:', resError);
            assistantReply += "\n\nI encountered an error saving your reservation. Please contact us directly.";
          } else {
            anyToolExecuted = true;
            toolExecutionContext.push(`created reservation for ${args.name}`);
            
            // Update conversation with customer name
            await supabase
              .from('conversations')
              .update({ customer_name: args.name })
              .eq('id', conversation.id);
              
            assistantReply += "\n\nYour reservation has been confirmed! We look forward to serving you.";
            
            // Send confirmation email if email provided
            if (args.email) {
              try {
                await supabase.functions.invoke('send-reservation-confirmation', {
                  body: {
                    name: args.name,
                    email: args.email,
                    date: args.date,
                    time: args.time,
                    guests: args.guests,
                    restaurantName: company.name
                  }
                });
                console.log('Confirmation email sent to:', args.email);
              } catch (emailError) {
                console.error('Failed to send confirmation email:', emailError);
              }
            }
            
            // Send company notification about new reservation
            try {
              await supabase.functions.invoke('send-company-notification', {
                body: {
                  company_id: company.id,
                  notification_type: 'reservation',
                  data: {
                    name: args.name,
                    phone: reservationPhone,
                    email: args.email || null,
                    date: args.date,
                    time: args.time,
                    guests: args.guests,
                    branch: args.branch,
                    area_preference: args.area_preference,
                    occasion: args.occasion
                  }
                }
              });
              console.log('Company notification sent for reservation');
            } catch (notifError) {
              console.error('Failed to send company notification:', notifError);
            }
          }
        }
      }
    }

    // Phase 2: Generate contextual message if AI didn't provide one but tools were executed
    console.log('Phase 2 check:', { 
      assistantReply, 
      anyToolExecuted, 
      toolExecutionContext,
      shouldGenerateContext: anyToolExecuted && (!assistantReply || assistantReply.trim() === '')
    });
    
    if (anyToolExecuted && (!assistantReply || assistantReply.trim() === '')) {
      console.log('Generating contextual response for tool executions:', toolExecutionContext);
      
      try {
        const contextPrompt = `You just ${toolExecutionContext.join(' and ')} to the customer. Generate a brief, friendly confirmation message (1-2 sentences max) in your natural voice that acknowledges what you sent. Keep it conversational and warm.`;
        
        const contextResponse = await fetch('https://api.moonshot.cn/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${KIMI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'moonshot-v1-32k',
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: contextPrompt }
            ],
            temperature: 0.3,
            max_tokens: 150
          }),
        });

        if (contextResponse.ok) {
          const contextData = await contextResponse.json();
          const contextualReply = contextData.choices[0].message.content || '';
          if (contextualReply.trim()) {
            assistantReply = contextualReply;
            console.log('Generated contextual response:', assistantReply);
          }
        }
      } catch (contextError) {
        console.error('Error generating contextual response:', contextError);
        // Fall through to the existing fallback
      }
    }

    // Extract customer name if they introduce themselves
    let customerName = conversation.customer_name;
    if (!customerName && Body) {
      const namePatterns = [
        /(?:my name is|i am|i'm|this is)\s+([a-z]+(?:\s+[a-z]+)?)/i,
        /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/
      ];
      for (const pattern of namePatterns) {
        const match = Body.match(pattern);
        if (match && match[1] && match[1].length > 2) {
          customerName = match[1];
          await supabase
            .from('conversations')
            .update({ customer_name: customerName })
            .eq('id', conversation.id);
          break;
        }
      }
    }

    // Ensure we always have a response
    if (!assistantReply || assistantReply.trim() === '') {
      assistantReply = "Thank you for your message. How can I help you today?";
      console.log('Warning: Empty AI response, using fallback message');
    }
    
    console.log('Final assistant reply to send:', assistantReply);

    // Prepare message metadata
    const messageMetadata = {
      media_urls: storedMediaUrls,
      media_types: storedMediaTypes,
      media_count: storedMediaUrls.length,
      message_type: storedMediaUrls.length > 0 
        ? (Body ? 'text_with_media' : 'media')
        : 'text'
    };
    
    // Insert user message into messages table
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: Body || (storedMediaUrls.length > 0 ? 'Sent media' : ''),
        message_metadata: messageMetadata
      });

    // Insert assistant message into messages table
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'assistant',
        content: assistantReply
      });

    // Update conversation transcript (keep for backward compatibility)
    const updatedTranscript = `${conversation.transcript}\nCustomer: ${Body}\nAssistant: ${assistantReply}\n`;
    await supabase
      .from('conversations')
      .update({ transcript: updatedTranscript })
      .eq('id', conversation.id);

    console.log('Sending WhatsApp response:', assistantReply);

    // Return TwiML response for Twilio to send the message
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${assistantReply}]]></Message>
</Response>`;

    return new Response(twimlResponse, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });

  } catch (error) {
    console.error("Error in WhatsApp handler:", error);
    // Return TwiML error response so user gets a message
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, I encountered an error. Please try again or contact us directly.]]></Message>
</Response>`, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }
});
