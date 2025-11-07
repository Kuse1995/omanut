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

    // Parse Twilio WhatsApp webhook payload
    const formData = await req.formData();
    const From = formData.get('From') as string; // User's WhatsApp number
    const To = formData.get('To') as string; // Business WhatsApp number
    const Body = formData.get('Body') as string; // Message text

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
      console.log('Message from management detected, routing to management chat');
      
      // Fetch company data for management context
      const { data: aiOverrides } = await supabase
        .from('company_ai_overrides')
        .select('*')
        .eq('company_id', company.id)
        .single();

      const { data: documents } = await supabase
        .from('company_documents')
        .select('filename, parsed_content')
        .eq('company_id', company.id)
        .not('parsed_content', 'is', null);

      const { data: recentConvs } = await supabase
        .from('conversations')
        .select('id, customer_name, phone, started_at, ended_at, status, quality_flag')
        .eq('company_id', company.id)
        .order('started_at', { ascending: false })
        .limit(10);

      const { data: recentReservations } = await supabase
        .from('reservations')
        .select('*')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(10);

      // Get demo bookings specifically
      const { data: demoBookings } = await supabase
        .from('reservations')
        .select('*')
        .eq('company_id', company.id)
        .ilike('occasion', '%demo%')
        .order('created_at', { ascending: false })
        .limit(10);

      console.log('Demo bookings found for management:', demoBookings?.length || 0, demoBookings);

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

      // Build knowledge base
      const knowledgeBase = documents
        ?.map((doc: any) => doc.parsed_content)
        .filter(Boolean)
        .join('\n\n') || '';

      const systemPrompt = `You are an AI assistant reporting to the management team of ${company.name}.
Management can ask you questions about customer interactions, reservations, and business insights.

Business Context:
- Type: ${company.business_type}
- Hours: ${company.hours}
- Services: ${company.services}

${aiOverrides?.system_instructions ? `Special Instructions: ${aiOverrides.system_instructions}` : ''}

${knowledgeBase ? `Knowledge Base:\n${knowledgeBase}` : ''}

Recent Conversation Stats (last 10):
${recentConvs?.map((c: any) => `- ${c.customer_name || 'Unknown'} (${c.phone}): ${c.status}, Quality: ${c.quality_flag || 'N/A'}`).join('\n') || 'No recent conversations'}

Demo Bookings (${demoBookings?.length || 0} total):
${demoBookings?.map((r: any) => `- ${r.name} (${r.phone}): ${r.occasion || 'Demo'} scheduled for ${r.date} at ${r.time}, Status: ${r.status}`).join('\n') || 'No demo bookings yet'}

Recent Reservations (last 10):
${recentReservations?.map((r: any) => `- ${r.name} (${r.phone}): ${r.guests || 'N/A'} guests on ${r.date} at ${r.time}${r.occasion ? ` (${r.occasion})` : ''}, Status: ${r.status}`).join('\n') || 'No recent reservations'}

Pending Action Items:
${actionItems?.map((a: any) => `- ${a.action_type}: ${a.description} (${a.priority} priority)`).join('\n') || 'No pending actions'}

Client Insights:
${clientInfo?.map((i: any) => `- ${i.customer_name || 'Unknown'}: ${i.info_type} - ${i.information}`).join('\n') || 'No client insights'}

Respond professionally and provide actionable insights when asked.`;

      // Call OpenAI for management response
      const managementResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: Body }
          ],
          max_tokens: 500
        }),
      });

      const managementData = await managementResponse.json();
      const aiResponse = managementData.choices[0].message.content;

      console.log('AI response for management:', aiResponse);

      // Log management conversation
      await supabase
        .from('boss_conversations')
        .insert({
          company_id: company.id,
          message_from: 'boss',
          message_content: Body,
          response: aiResponse
        });

      // Return TwiML response
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${aiResponse}</Message>
</Response>`;

      return new Response(twiml, {
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
          const url = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/company-media/${media.file_path}`;
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

2. When answering questions, ALWAYS check the Company Knowledge Base first for accurate information.

3. When taking a booking, you only need to ask for:
   - Their NAME (ask once: "May I have your name please?")
   - DATE and TIME of booking
   - NUMBER OF GUESTS
   - WHICH BRANCH (if multiple locations) - Example: "${businessPrompt.location_prompt}"
   - LOCATION PREFERENCE (if applicable)
   
4. NEVER ask for the same information twice. Once they give you their name, use it in the conversation.

5. Before creating a reservation, confirm ALL details ONCE using this format:
   "Perfect! Let me confirm: [NAME], ${customerPhone}, ${businessPrompt.confirmation.replace('{guests}', '[GUESTS]').replace('{date}', '[DATE]').replace('{time}', '[TIME]').replace('{location}', '[LOCATION]')}. Is that correct?"
   Only call create_reservation after they confirm.

6. Track what information you already have. Look at the conversation history to see what they've told you.

7. Be concise and natural. Don't sound like a robot repeating questions.

8. Always speak in warm, respectful Zambian English.

9. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.`;

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

    // Call OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
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
              description: "Send the most relevant image or video based on customer's request. Match their intent to the appropriate media category and content. Examples: 'show menu' → MENU category, 'your logo' → LOGO category, 'how it looks' → INTERIOR/EXTERIOR categories.",
              parameters: {
                type: "object",
                properties: {
                  media_url: {
                    type: "string",
                    description: "The complete URL of the most relevant media file from the library"
                  },
                  caption: {
                    type: "string",
                    description: "A friendly, contextual caption explaining what the media shows"
                  },
                  category: {
                    type: "string",
                    description: "Category of media being sent (menu, interior, exterior, logo, products, promotional, staff, events, facilities, other) - for tracking purposes"
                  }
                },
                required: ["media_url", "category"]
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
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiData = await response.json();
    let assistantReply = aiData.choices[0].message.content || '';
    const toolCalls = aiData.choices[0].message.tool_calls;

    console.log('AI response:', { assistantReply, toolCalls });

    // Handle tool calls (reservation creation, media sending, and payment requests)
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'request_payment') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('AI requesting payment:', args);
          
          try {
            // Call edge function to create payment link
            const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
            const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
            
            const paymentResponse = await fetch(
              `${SUPABASE_URL}/functions/v1/create-payment-link`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  company_id: company.id,
                  conversation_id: conversation.id,
                  product_id: args.product_id,
                  customer_phone: From,
                  customer_name: conversation.customer_name || args.customer_details?.name,
                  payment_method: args.payment_method,
                  amount: args.amount,
                  metadata: args.customer_details
                })
              }
            );
            
            if (paymentResponse.ok) {
              const paymentData = await paymentResponse.json();
              
              // Build payment message based on method
              let paymentMessage = `Great! To proceed with your *${args.product_name}* for ${company.currency_prefix}${args.amount}, `;
              
              if (args.payment_method === 'selar') {
                paymentMessage += `please complete payment using this link:\n\n${paymentData.payment_link}\n\n`;
                paymentMessage += `✅ Accepts all major cards\n✅ Secure international payment\n`;
              } else {
                paymentMessage += `please complete payment via ${args.payment_method.toUpperCase()} Mobile Money:\n\n`;
                paymentMessage += `📱 Dial: ${paymentData.ussd_code}\n`;
                paymentMessage += `📝 Reference: ${paymentData.payment_reference}\n\n`;
                paymentMessage += `You'll receive a prompt on your phone to authorize the payment.\n`;
              }
              
              paymentMessage += `\nOnce payment is confirmed, I'll notify our team to start working on your project immediately! 🚀`;
              
              assistantReply = paymentMessage;
              
              console.log('Payment link generated successfully:', paymentData.transaction_id);
            } else {
              const errorText = await paymentResponse.text();
              console.error('Failed to create payment link:', errorText);
              assistantReply += "\n\nI encountered an error generating the payment link. Please try again or contact us directly.";
            }
          } catch (paymentError) {
            console.error('Error processing payment request:', paymentError);
            assistantReply += "\n\nI encountered an error processing your payment request. Please try again.";
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
              
              const formData = new URLSearchParams();
              const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
                ? company.whatsapp_number 
                : `whatsapp:${company.whatsapp_number}`;
              formData.append('From', fromNumber);
              formData.append('To', From);
              formData.append('Body', args.caption || '');
              formData.append('MediaUrl', args.media_url);

              const twilioResponse = await fetch(twilioUrl, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData.toString(),
              });

              if (!twilioResponse.ok) {
                const errorText = await twilioResponse.text();
                console.error('Twilio API error sending media:', twilioResponse.status, errorText);
                assistantReply += "\n\nI tried to send you the media but encountered an error. Please let me know if you'd like me to try again.";
              } else {
                console.log('Media sent successfully via Twilio');
                // Log the media send in messages table
                await supabase
                  .from('messages')
                  .insert({
                    conversation_id: conversation.id,
                    role: 'assistant',
                    content: `[Sent media: ${args.media_url}]${args.caption ? ' - ' + args.caption : ''}`
                  });
              }
            } catch (twilioError) {
              console.error('Error sending media via Twilio:', twilioError);
              assistantReply += "\n\nI tried to send you the media but encountered an error.";
            }
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

    // Insert user message into messages table
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: Body
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
