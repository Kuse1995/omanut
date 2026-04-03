import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_KEY = () => Deno.env.get('GEMINI_API_KEY');

interface AttachmentAnalysisResult {
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
  category: 'payment_proof' | 'product_image' | 'document' | 'screenshot' | 'photo' | 'voice_note' | 'audio' | 'pdf_document' | 'other';
  transcription?: string;
  audioSummary?: string;
  documentContent?: string;
  documentType?: string;
}

/**
 * Fetch media bytes with Twilio auth if needed, return as base64 + mime.
 */
async function fetchMediaAsBase64(url: string, mimeHint?: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const headers: Record<string, string> = {};
    // Twilio media URLs need auth
    if (url.includes('twilio.com') || url.includes('api.twilio.com')) {
      const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const token = Deno.env.get('TWILIO_AUTH_TOKEN');
      if (sid && token) {
        headers['Authorization'] = 'Basic ' + btoa(`${sid}:${token}`);
      }
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      console.error(`[ANALYZE] Failed to fetch media: ${resp.status}`);
      return null;
    }
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Chunk-safe base64 encoding
    let b64 = '';
    const chunkSize = 32768;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      b64 += String.fromCharCode.apply(null, [...bytes.subarray(i, i + chunkSize)]);
    }
    b64 = btoa(b64);
    const mimeType = resp.headers.get('content-type') || mimeHint || 'application/octet-stream';
    return { base64: b64, mimeType };
  } catch (e) {
    console.error('[ANALYZE] fetchMediaAsBase64 error:', e);
    return null;
  }
}

/**
 * Call Gemini native API with inline_data parts (supports image, audio, PDF).
 */
async function geminiAnalyze(parts: any[], systemPrompt: string): Promise<string> {
  const apiKey = GEMINI_API_KEY();
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`[ANALYZE] Gemini error ${response.status}:`, err);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

// ───────────── Image Analysis (existing logic, unchanged) ─────────────
async function analyzeImage(imageUrl: string, businessContext?: string): Promise<AttachmentAnalysisResult> {
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

  // Use inline_data for reliability (handles Twilio auth)
  const media = await fetchMediaAsBase64(imageUrl);
  let parts: any[];
  if (media) {
    parts = [
      { text: 'Analyze this image and extract relevant information:' },
      { inlineData: { mimeType: media.mimeType, data: media.base64 } },
    ];
  } else {
    // Fallback to URL reference
    parts = [
      { text: 'Analyze this image and extract relevant information:' },
      { fileData: { fileUri: imageUrl, mimeType: 'image/jpeg' } },
    ];
  }

  const raw = await geminiAnalyze(parts, systemPrompt);
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { isPaymentProof: false, confidence: 0.3, extractedData: {}, description: 'Unable to analyze image', category: 'other' };
  }
}

// ───────────── Audio Analysis (new) ─────────────
async function analyzeAudio(audioUrl: string, mediaType: string, businessContext?: string): Promise<AttachmentAnalysisResult> {
  console.log('[ANALYZE-AUDIO] Processing:', audioUrl, mediaType);

  const media = await fetchMediaAsBase64(audioUrl, mediaType);
  if (!media) {
    return { isPaymentProof: false, confidence: 0, extractedData: {}, description: 'Could not download audio', category: 'audio' };
  }

  const systemPrompt = `You are an expert assistant for a business WhatsApp AI. 
A customer sent a voice note or audio message. Your job:
1. Transcribe the audio content accurately
2. Summarize the key intent/request in 1-2 sentences
3. Detect if the customer mentions any product names, quantities, prices, dates, or phone numbers

${businessContext ? `Business context: ${businessContext}` : ''}

Respond with ONLY valid JSON (no markdown):
{
  "transcription": "Full transcription of the audio",
  "audioSummary": "1-2 sentence summary of what the customer wants",
  "description": "Voice note from customer: [brief topic]",
  "category": "voice_note",
  "isPaymentProof": false,
  "confidence": 0,
  "extractedData": {}
}`;

  const parts = [
    { text: 'Transcribe and analyze this voice note from a customer:' },
    { inlineData: { mimeType: media.mimeType, data: media.base64 } },
  ];

  const raw = await geminiAnalyze(parts, systemPrompt);
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { isPaymentProof: false, confidence: 0, extractedData: {}, description: 'Could not transcribe audio', category: 'audio' };
  }
}

// ───────────── PDF / Document Analysis (new) ─────────────
async function analyzeDocument(docUrl: string, mediaType: string, businessContext?: string): Promise<AttachmentAnalysisResult> {
  console.log('[ANALYZE-DOC] Processing:', docUrl, mediaType);

  const media = await fetchMediaAsBase64(docUrl, mediaType);
  if (!media) {
    return { isPaymentProof: false, confidence: 0, extractedData: {}, description: 'Could not download document', category: 'pdf_document' };
  }

  const systemPrompt = `You are an expert document analyzer for a business WhatsApp AI.
A customer sent a document (PDF or other). Your job:
1. Extract the key content and purpose of the document
2. Identify if it's a purchase order, contract, ID document, receipt, or other type
3. Extract any relevant data: amounts, dates, names, item lists, reference numbers

${businessContext ? `Business context: ${businessContext}` : ''}

Respond with ONLY valid JSON (no markdown):
{
  "documentContent": "Key extracted content from the document (max 500 words)",
  "documentType": "purchase_order" | "contract" | "receipt" | "id_document" | "invoice" | "other",
  "description": "Customer shared a [type] document containing [brief summary]",
  "category": "pdf_document",
  "isPaymentProof": false,
  "confidence": 0,
  "extractedData": {
    "amount": "string or null",
    "transactionReference": "string or null",
    "senderName": "string or null"
  }
}`;

  const parts = [
    { text: 'Analyze this document sent by a customer and extract key information:' },
    { inlineData: { mimeType: media.mimeType, data: media.base64 } },
  ];

  const raw = await geminiAnalyze(parts, systemPrompt);
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { isPaymentProof: false, confidence: 0, extractedData: {}, description: 'Could not analyze document', category: 'pdf_document' };
  }
}

// ───────────── Main handler ─────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, mediaType, businessContext } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'imageUrl is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveMediaType = (mediaType || '').toLowerCase();
    console.log(`[ANALYZE] mediaType=${effectiveMediaType}, url=${imageUrl}`);

    let result: AttachmentAnalysisResult;

    if (effectiveMediaType.startsWith('audio/') || effectiveMediaType === 'audio/ogg; codecs=opus') {
      // Voice notes & audio
      result = await analyzeAudio(imageUrl, effectiveMediaType, businessContext);
    } else if (effectiveMediaType === 'application/pdf' || effectiveMediaType.includes('pdf')) {
      // PDF documents
      result = await analyzeDocument(imageUrl, effectiveMediaType, businessContext);
    } else if (
      effectiveMediaType.startsWith('application/') &&
      !effectiveMediaType.includes('json') &&
      !effectiveMediaType.includes('xml')
    ) {
      // Other document types (docx, xlsx, etc.)
      result = await analyzeDocument(imageUrl, effectiveMediaType, businessContext);
    } else {
      // Default: image analysis (existing behavior)
      result = await analyzeImage(imageUrl, businessContext);
    }

    console.log('[ANALYZE] Result:', JSON.stringify(result).substring(0, 300));

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[ANALYZE] Error:', error);
    const errorMessage = 'An error occurred processing your request';
    return new Response(
      JSON.stringify({
        error: errorMessage,
        isPaymentProof: false,
        confidence: 0,
        extractedData: {},
        description: 'Attachment analysis failed',
        category: 'other'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
