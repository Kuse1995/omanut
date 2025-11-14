import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.21.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Background processing function that handles AI response
async function processAIResponse(
  conversationId: string,
  companyId: string,
  userMessage: string,
  storedMediaUrls: string[],
  storedMediaTypes: string[],
  customerPhone: string
) {
  console.log('[BACKGROUND] Starting AI processing for conversation:', conversationId);
  
  const KIMI_API_KEY = Deno.env.get('KIMI_API_KEY');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Fetch conversation and company data
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    const { data: company } = await supabase
      .from('companies')
      .select('*, metadata')
      .eq('id', companyId)
      .single();

    if (!conversation || !company) {
      console.error('[BACKGROUND] Failed to fetch conversation or company data');
      return;
    }

    // Fetch AI overrides and other company data
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company.id)
      .maybeSingle();

    const { data: documents } = await supabase
      .from('company_documents')
      .select('*')
      .eq('company_id', company.id)
      .eq('status', 'processed');

    const { data: mediaLibrary } = await supabase
      .from('company_media')
      .select('*')
      .eq('company_id', company.id)
      .eq('status', 'processed');

    // Build AI instructions
    let instructions = `You are a friendly AI assistant for ${company.name}`;
    
    if (company.industry) {
      instructions += ` (${company.industry})`;
    }
    
    instructions += `.

Business Information:
- Business Name: ${company.name}
- Phone: ${company.phone}
- Address: ${company.address || 'Not specified'}
${company.business_hours ? `- Hours: ${company.business_hours}` : ''}
${company.services ? `- Services: ${company.services}` : ''}
${company.currency_prefix ? `- Currency: ${company.currency_prefix}` : ''}
${company.email ? `- Email: ${company.email}` : ''}`;

    // Add AI overrides if present
    if (aiOverrides) {
      if (aiOverrides.custom_greeting) {
        instructions += `\n\nGreeting Style: ${aiOverrides.custom_greeting}`;
      }
      if (aiOverrides.response_tone) {
        instructions += `\nTone: ${aiOverrides.response_tone}`;
      }
      if (aiOverrides.additional_instructions) {
        instructions += `\n\nAdditional Instructions:\n${aiOverrides.additional_instructions}`;
      }
    }

    // Add knowledge base
    if (documents && documents.length > 0) {
      instructions += '\n\n=== KNOWLEDGE BASE ===\n';
      for (const doc of documents) {
        instructions += `\nDocument: ${doc.file_name}\n${doc.content}\n`;
      }
    }

    // Add media library
    if (mediaLibrary && mediaLibrary.length > 0) {
      instructions += '\n\n=== MEDIA LIBRARY ===\n';
      instructions += 'Available media files (use send_media tool to share):\n';
      for (const media of mediaLibrary) {
        instructions += `- ${media.title} (${media.category}): ${media.file_url}\n`;
        if (media.description) {
          instructions += `  Description: ${media.description}\n`;
        }
      }
    }

    instructions += `\n\nKey Guidelines:
1. Be warm, friendly, and professional
2. Answer questions about our business using the information above
3. For reservations, collect ALL required details before calling create_reservation
4. When customers ask for samples/photos/videos, IMMEDIATELY use send_media tool
5. For payments, use request_payment tool to notify management
6. Keep responses concise and conversational
7. If you don't know something, admit it politely
8. Never make up information not provided above
9. CRITICAL: When sending media, do NOT say you'll send it - just call send_media immediately
10. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.`;

    // Build conversation history
    const transcriptLines = conversation.transcript.split('\n').filter((line: string) => line.trim());
    const recentHistory = transcriptLines.slice(-20).join('\n');

    const messages = [
      { role: 'system', content: instructions }
    ];

    if (recentHistory.trim()) {
      messages.push({ role: 'user', content: `Previous conversation:\n${recentHistory}` });
    }

    messages.push({ role: 'user', content: userMessage });

    // Call Kimi AI with extended timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    
    let assistantReply = '';
    let anyToolExecuted = false;
    let toolExecutionContext: string[] = [];

    try {
      const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIMI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'kimi-k2-thinking',
          messages,
          temperature: 1.0,
          tools: [
            {
              type: "function",
              function: {
                name: "create_reservation",
                description: "Create a booking ONLY after confirming all details with the customer.",
                parameters: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Customer's full name" },
                    phone: { type: "string", description: "Customer's phone number" },
                    date: { type: "string", description: "Date in YYYY-MM-DD format" },
                    time: { type: "string", description: "Time in HH:MM 24-hour format" },
                    guests: { type: "number", description: "Number of guests" },
                    occasion: { type: "string", description: "Occasion or reason for booking" },
                    area_preference: { type: "string", description: "Seating preference" },
                    branch: { type: "string", description: "Branch or location" },
                    email: { type: "string", description: "Email address (optional)" }
                  },
                  required: ["name", "phone", "date", "time", "guests", "area_preference", "branch"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "send_media",
                description: "Send media files to customer via WhatsApp. Use when customer asks for samples, photos, videos, or examples.",
                parameters: {
                  type: "object",
                  properties: {
                    media_urls: {
                      type: "array",
                      items: { type: "string" },
                      description: "Array of media file URLs from the library"
                    },
                    caption: {
                      type: "string",
                      description: "Caption for the media"
                    },
                    category: {
                      type: "string",
                      description: "Category of media (menu, interior, exterior, logo, products, etc.)"
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
                description: "Request payment from customer and notify management",
                parameters: {
                  type: "object",
                  properties: {
                    product_id: { type: "string" },
                    product_name: { type: "string" },
                    amount: { type: "number" },
                    payment_method: { type: "string" },
                    customer_details: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        email: { type: "string" }
                      }
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
        console.error('[BACKGROUND] Kimi AI error:', response.status, errorText);
        throw new Error(`Kimi AI error: ${response.status}`);
      }

      const aiData = await response.json();
      assistantReply = aiData.choices[0].message.content || '';
      const toolCalls = aiData.choices[0].message.tool_calls;

      console.log('[BACKGROUND] AI response:', { assistantReply, toolCalls });

      // Handle tool calls
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (toolCall.function.name === 'request_payment') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Processing payment request:', args);
            
            try {
              await supabase.functions.invoke('send-boss-notification', {
                body: {
                  companyId: company.id,
                  notificationType: 'payment_request',
                  data: {
                    customer_name: conversation.customer_name || args.customer_details?.name || 'Unknown',
                    customer_phone: `whatsapp:${customerPhone}`,
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
              assistantReply = `Thank you for your interest in *${args.product_name}*! Our team has been notified and will contact you shortly with payment instructions. 📱`;
            } catch (error) {
              console.error('[BACKGROUND] Payment request error:', error);
              assistantReply += "\n\nI encountered an error processing your payment request. Please try again.";
            }
          } else if (toolCall.function.name === 'send_media') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Sending media:', args);
            
            const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
            
            if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
              try {
                const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
                const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
                  ? company.whatsapp_number 
                  : `whatsapp:${company.whatsapp_number}`;

                // Generate signed URLs for media
                const signedMediaUrls: string[] = [];
                for (const mediaUrl of args.media_urls) {
                  const urlParts = mediaUrl.split('/company-media/');
                  if (urlParts.length === 2) {
                    const filePath = urlParts[1];
                    const { data: signedData } = await supabase.storage
                      .from('company-media')
                      .createSignedUrl(filePath, 3600);
                    
                    if (signedData?.signedUrl) {
                      signedMediaUrls.push(signedData.signedUrl);
                    }
                  }
                }

                if (signedMediaUrls.length > 0) {
                  let successCount = 0;
                  
                  for (let i = 0; i < signedMediaUrls.length; i++) {
                    const formData = new URLSearchParams();
                    formData.append('From', fromNumber);
                    formData.append('To', `whatsapp:${customerPhone}`);
                    formData.append('Body', i === 0 && args.caption ? args.caption : '');
                    formData.append('MediaUrl', signedMediaUrls[i]);

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
                    }
                  }

                  await supabase
                    .from('messages')
                    .insert({
                      conversation_id: conversationId,
                      role: 'assistant',
                      content: `[Sent ${signedMediaUrls.length} ${args.category} media file(s)]${args.caption ? ' - ' + args.caption : ''}`
                    });

                  if (successCount === signedMediaUrls.length) {
                    anyToolExecuted = true;
                    toolExecutionContext.push(`sent ${signedMediaUrls.length} ${args.category} media file(s)`);
                    console.log('[BACKGROUND] All media sent successfully');
                  }
                }
              } catch (error) {
                console.error('[BACKGROUND] Media send error:', error);
                assistantReply = "I tried to send the media but encountered an error.";
              }
            }
          } else if (toolCall.function.name === 'create_reservation') {
            const args = JSON.parse(toolCall.function.arguments);
            const reservationPhone = args.phone || customerPhone;
            
            const { error: resError } = await supabase
              .from('reservations')
              .insert({
                company_id: company.id,
                conversation_id: conversationId,
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
              console.error('[BACKGROUND] Reservation error:', resError);
              assistantReply += "\n\nI encountered an error saving your reservation. Please contact us directly.";
            } else {
              anyToolExecuted = true;
              toolExecutionContext.push(`created reservation for ${args.name}`);
              
              await supabase
                .from('conversations')
                .update({ customer_name: args.name })
                .eq('id', conversationId);
                
              assistantReply += "\n\nYour reservation has been confirmed! We look forward to serving you.";
              
              if (args.email) {
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
              }
            }
          }
        }
      }

      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[BACKGROUND] AI processing error:', error);
      assistantReply = `I apologize, but I'm experiencing some technical difficulties. Please try again in a moment. If this persists, contact us at ${company.phone || 'our main number'}.`;
    }

    // Generate contextual message if tools were executed but no reply
    if (anyToolExecuted && (!assistantReply || assistantReply.trim() === '')) {
      assistantReply = "Done! Let me know if you need anything else.";
    }

    // Ensure we have a response
    if (!assistantReply || assistantReply.trim() === '') {
      assistantReply = "Thank you for your message. How can I help you today?";
    }

    console.log('[BACKGROUND] Final reply:', assistantReply);

    // Insert assistant message
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: assistantReply
      });

    // Update conversation transcript
    const updatedTranscript = `${conversation.transcript}\nCustomer: ${userMessage}\nAssistant: ${assistantReply}\n`;
    await supabase
      .from('conversations')
      .update({ transcript: updatedTranscript })
      .eq('id', conversationId);

    // Send response via Twilio API
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
        ? company.whatsapp_number 
        : `whatsapp:${company.whatsapp_number}`;

      const formData = new URLSearchParams();
      formData.append('From', fromNumber);
      formData.append('To', `whatsapp:${customerPhone}`);
      formData.append('Body', assistantReply);

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (twilioResponse.ok) {
        console.log('[BACKGROUND] Response sent successfully via Twilio');
      } else {
        const errorText = await twilioResponse.text();
        console.error('[BACKGROUND] Twilio send error:', twilioResponse.status, errorText);
      }
    }

  } catch (error) {
    console.error('[BACKGROUND] Fatal error in background processing:', error);
  }
}

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
    const From = formData.get('From') as string;
    const To = formData.get('To') as string;
    const Body = formData.get('Body') as string || '';
    
    // Extract media information
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
      console.error('Database error:', companyError);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Our service is temporarily unavailable. Please try again later.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    if (!company) {
      console.error('Company not found for:', To);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[This WhatsApp number is not configured. Please contact support.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Check if message is from boss
    const normalizePhone = (phone: string) => {
      return phone.replace(/^whatsapp:/i, '').replace(/\+/g, '').replace(/\s/g, '');
    };
    
    const fromPhone = normalizePhone(From);
    const bossPhone = company.boss_phone ? normalizePhone(company.boss_phone) : '';
    
    console.log('Phone comparison:', { fromPhone, bossPhone, isBoss: fromPhone === bossPhone });
    
    if (company.boss_phone && fromPhone === bossPhone) {
      console.log('Message from BOSS - handling with boss-chat function');
      
      // Forward to boss-chat function
      const { data: bossData, error: bossError } = await supabase.functions.invoke('boss-chat', {
        body: { From, To, Body, ProfileName: formData.get('ProfileName') }
      });

      if (bossError) {
        console.error('Boss chat error:', bossError);
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Error processing your request. Please try again.</Message>
</Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
        });
      }

      const bossResponse = bossData?.response || 'Message received.';
      const bossTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${bossResponse}]]></Message>
</Response>`;
      
      console.log('Boss TwiML Response Length:', bossTwiml.length);
      console.log('Returning Boss TwiML to Twilio at:', new Date().toISOString());

      return new Response(bossTwiml, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Customer message handling
    console.log('Processing customer message');

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

    const customerPhone = From.replace('whatsapp:', '');
    
    // Find or create conversation
    let { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('company_id', company.id)
      .eq('phone', From)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Check human takeover mode
    if (conversation && conversation.human_takeover) {
      console.log('Human takeover mode - storing message only');
      
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'user',
          content: Body
        });
      
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

    // Deduct credits
    await supabase.rpc('deduct_credits', {
      p_company_id: company.id,
      p_amount: 1,
      p_reason: 'whatsapp_message',
      p_conversation_id: conversation.id
    });
    
    // Handle media files
    const storedMediaUrls: string[] = [];
    const storedMediaTypes: string[] = [];
    
    if (mediaFiles.length > 0) {
      console.log(`Processing ${mediaFiles.length} media files`);
      
      for (let i = 0; i < mediaFiles.length; i++) {
        const media = mediaFiles[i];
        try {
          const mediaResponse = await fetch(media.url);
          if (!mediaResponse.ok) continue;
          
          const mediaBlob = await mediaResponse.arrayBuffer();
          const fileExt = media.contentType.split('/')[1] || 'bin';
          const fileName = `${conversation.id}/${Date.now()}_${i}.${fileExt}`;
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('conversation-media')
            .upload(fileName, mediaBlob, {
              contentType: media.contentType,
              upsert: false
            });
          
          if (uploadError) {
            console.error(`Upload error:`, uploadError);
            continue;
          }
          
          const { data: { publicUrl } } = supabase.storage
            .from('conversation-media')
            .getPublicUrl(fileName);
          
          storedMediaUrls.push(publicUrl);
          storedMediaTypes.push(media.contentType);
          console.log(`Media ${i} stored:`, publicUrl);
        } catch (error) {
          console.error(`Media processing error:`, error);
        }
      }
    }

    // Insert user message immediately
    const messageMetadata = {
      media_urls: storedMediaUrls,
      media_types: storedMediaTypes,
      media_count: storedMediaUrls.length,
      message_type: storedMediaUrls.length > 0 
        ? (Body ? 'text_with_media' : 'media')
        : 'text'
    };
    
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: Body || (storedMediaUrls.length > 0 ? 'Sent media' : ''),
        message_metadata: messageMetadata
      });

    console.log('User message stored, starting background AI processing');

    // Start background processing - THIS IS THE KEY CHANGE
    // @ts-ignore - EdgeRuntime is a Deno Deploy global
    EdgeRuntime.waitUntil(
      processAIResponse(
        conversation.id,
        company.id,
        Body,
        storedMediaUrls,
        storedMediaTypes,
        customerPhone
      )
    );

    // Return immediate acknowledgment to Twilio (prevents timeout)
    const immediateTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Processing your message...]]></Message>
</Response>`;

    console.log('Returning immediate TwiML response at:', new Date().toISOString());

    return new Response(immediateTwiml, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });

  } catch (error) {
    console.error("Error in WhatsApp handler:", error);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, I encountered an error. Please try again or contact us directly.]]></Message>
</Response>`, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }
});
