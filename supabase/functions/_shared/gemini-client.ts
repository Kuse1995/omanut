/**
 * Shared Gemini API client for all edge functions.
 * All models (text + image) route through direct Gemini OpenAI-compatible endpoint.
 */

const GEMINI_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

/** Strip provider prefix from model names (e.g. "google/gemini-2.5-flash" → "gemini-2.5-flash") */
function normalizeModel(model: string): string {
  return model.replace(/^(google|openai)\//, '');
}

export interface GeminiChatOptions {
  model: string;
  messages: Array<{ role: string; content: any }>;
  temperature?: number;
  max_tokens?: number;
  tools?: any[];
  tool_choice?: any;
  modalities?: string[];
  stream?: boolean;
  signal?: AbortSignal;
}

/**
 * Call Gemini API directly for all models (text and image).
 */
export async function geminiChat(options: GeminiChatOptions): Promise<Response> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const normalizedModel = normalizeModel(options.model);

  const body: any = {
    model: normalizedModel,
    messages: options.messages,
  };

  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  if (options.tools) body.tools = options.tools;
  if (options.tool_choice) body.tool_choice = options.tool_choice;
  if (options.modalities) body.modalities = options.modalities;
  if (options.stream !== undefined) body.stream = options.stream;

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };

  if (options.signal) {
    fetchOptions.signal = options.signal;
  }

  return fetch(GEMINI_OPENAI_URL, fetchOptions);
}

/**
 * Generate images using the native Gemini API (not OpenAI-compatible).
 * The OpenAI chat/completions endpoint doesn't support image generation for these models.
 */
export async function geminiImageGenerate(options: {
  model?: string;
  prompt: string;
}): Promise<{ imageBase64: string | null; text: string | null }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = normalizeModel(options.model || 'gemini-3-pro-image-preview');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: options.prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini image gen error (${response.status}):`, errText);
    throw Object.assign(new Error(`Image generation failed: ${response.status}`), { status: response.status });
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];

  let imageBase64: string | null = null;
  let text: string | null = null;

  for (const part of parts) {
    if (part.inlineData) {
      imageBase64 = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
    if (part.text) {
      text = part.text;
    }
  }

  return { imageBase64, text };
}

/**
 * Convenience wrapper that returns parsed JSON response (non-streaming).
 */
export async function geminiChatJSON(options: GeminiChatOptions): Promise<any> {
  const response = await geminiChat(options);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Gemini API error (${response.status}):`, errorText);

    if (response.status === 429) {
      throw Object.assign(new Error('Rate limit exceeded. Please try again later.'), { status: 429 });
    }
    if (response.status === 402 || response.status === 403) {
      throw Object.assign(new Error('API quota exceeded. Check your API plan.'), { status: 402 });
    }
    throw Object.assign(new Error(`API error: ${response.status}`), { status: response.status });
  }

  return response.json();
}
