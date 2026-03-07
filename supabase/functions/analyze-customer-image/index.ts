import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImageAnalysisResult {
  isPaymentProof: boolean;
  confidence: number;
  extractedData: {
    amount?: string;
    transactionReference?: string;
    senderName?: string;
    recipientName?: string;
    recipientNumber?: string;
    timestamp?: string;
    provider?: string;
  };
  description: string;
  category: 'payment_proof' | 'product_image' | 'document' | 'screenshot' | 'photo' | 'other';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, businessContext } = await req.json();
    
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'Image URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Using Gemini client

    console.log('[ANALYZE-IMAGE] Analyzing image:', imageUrl);

    // Construct the vision analysis prompt
    const systemPrompt = `You are an expert image analyzer for a business WhatsApp AI assistant. 
Your task is to analyze images sent by customers and extract relevant information.

IMPORTANT: Pay special attention to mobile money payment screenshots (MTN, Airtel, Zamtel). 
These are common in Zambia for payment confirmations.

For payment proof images, extract:
- Transaction amount (look for "K" or "ZMW" prefix)
- Transaction reference/ID
- Sender name
- Recipient name and/or phone number
- Transaction date/time
- Payment provider (MTN, Airtel, Zamtel, bank name)

For other images, provide:
- A brief description of what's in the image
- Category classification

${businessContext ? `Business context: ${businessContext}` : ''}

Respond with ONLY valid JSON (no markdown):
{
  "isPaymentProof": boolean,
  "confidence": 0.0-1.0,
  "extractedData": {
    "amount": "string or null",
    "transactionReference": "string or null",
    "senderName": "string or null",
    "recipientName": "string or null",
    "recipientNumber": "string or null",
    "timestamp": "string or null",
    "provider": "string or null"
  },
  "description": "Brief description of the image",
  "category": "payment_proof" | "product_image" | "document" | "screenshot" | "photo" | "other"
}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this image and extract relevant information:' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ANALYZE-IMAGE] API error:', response.status, errorText);
      throw new Error(`Vision API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    
    console.log('[ANALYZE-IMAGE] Raw response:', content);

    // Parse JSON response
    let analysisResult: ImageAnalysisResult;
    try {
      const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
      analysisResult = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('[ANALYZE-IMAGE] Parse error, using fallback:', parseError);
      analysisResult = {
        isPaymentProof: false,
        confidence: 0.3,
        extractedData: {},
        description: 'Unable to analyze image content',
        category: 'other'
      };
    }

    console.log('[ANALYZE-IMAGE] Analysis result:', analysisResult);

    return new Response(
      JSON.stringify(analysisResult),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[ANALYZE-IMAGE] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        isPaymentProof: false,
        confidence: 0,
        extractedData: {},
        description: 'Image analysis failed',
        category: 'other'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
