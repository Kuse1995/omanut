/**
 * Shared Gemini API client for all edge functions.
 * Routes ALL models (text + image) through direct Google Gemini API using GEMINI_API_KEY.
 *
 * Text models use the OpenAI-compatible endpoint.
 * Image generation models use the native Gemini REST API.
 */

const GEMINI_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_NATIVE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Strip provider prefix from model names (e.g. "google/gemini-2.5-flash" → "gemini-2.5-flash") */
function normalizeModel(model: string): string {
  return model.replace(/^(google|openai)\//, '');
}

/** Check if a model is an image-generation model that needs the native API */
function isImageModel(model: string): boolean {
  const normalized = normalizeModel(model);
  return normalized.includes('image');
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
 * Call Google Gemini API. Returns the same JSON shape as OpenAI chat completions.
 * For image models, uses native Gemini API and reshapes the response.
 */
export async function geminiChat(options: GeminiChatOptions): Promise<Response> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const normalizedModel = normalizeModel(options.model);

  // Image generation models route through native Gemini API
  if (isImageModel(normalizedModel)) {
    return nativeGeminiImageCall(normalizedModel, options, apiKey);
  }

  // Text models use direct Gemini OpenAI-compatible endpoint
  const body: any = {
    model: normalizedModel,
    messages: options.messages,
  };

  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  if (options.tools) body.tools = options.tools;
  if (options.tool_choice) body.tool_choice = options.tool_choice;
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
      throw Object.assign(new Error('API quota exceeded. Check your Gemini API plan.'), { status: 402 });
    }
    throw Object.assign(new Error(`Gemini API error: ${response.status}`), { status: response.status });
  }

  return response.json();
}

/**
 * Route image generation through native Gemini REST API.
 * Converts messages to Gemini native format, calls generateContent,
 * and reshapes the response to match OpenAI-compatible format with `images` array.
 */
async function nativeGeminiImageCall(
  model: string,
  options: GeminiChatOptions,
  apiKey: string,
): Promise<Response> {
  console.log(`[gemini-client] Routing image model "${model}" through native Gemini API`);

  // Convert OpenAI-style messages to Gemini native format
  const contents: any[] = [];
  for (const msg of options.messages) {
    if (msg.role === 'system') {
      // System messages become user messages in Gemini native API
      contents.push({
        role: 'user',
        parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
      });
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      contents.push({ role, parts: [{ text: msg.content }] });
    } else if (Array.isArray(msg.content)) {
      // Multimodal content (text + images)
      const parts: any[] = [];
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image_url') {
          const url = part.image_url?.url || '';
          if (url.startsWith('data:')) {
            // Base64 inline data
            const matches = url.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              parts.push({
                inlineData: {
                  mimeType: matches[1],
                  data: matches[2]
                }
              });
            }
          } else {
            // URL - fetch and convert to base64
            try {
              const imgResp = await fetch(url);
              const imgBuffer = await imgResp.arrayBuffer();
              const base64 = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));
              const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
              parts.push({
                inlineData: {
                  mimeType: contentType,
                  data: base64
                }
              });
            } catch (e) {
              console.error('[gemini-client] Failed to fetch image URL:', e);
              parts.push({ text: `[Image URL: ${url}]` });
            }
          }
        }
      }
      contents.push({ role, parts });
    }
  }

  const body: any = {
    contents,
    generationConfig: {
      responseModalities: options.modalities || ['image', 'text'],
    }
  };

  if (options.temperature !== undefined) {
    body.generationConfig.temperature = options.temperature;
  }
  if (options.max_tokens !== undefined) {
    body.generationConfig.maxOutputTokens = options.max_tokens;
  }

  const url = `${GEMINI_NATIVE_URL}/${model}:generateContent?key=${apiKey}`;

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };

  if (options.signal) {
    fetchOptions.signal = options.signal;
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    // Pass through the error response as-is
    return response;
  }

  // Parse native Gemini response and reshape to OpenAI-compatible format
  const nativeData = await response.json();

  const candidate = nativeData.candidates?.[0];
  if (!candidate) {
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'No response generated', images: [] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  let textContent = '';
  const images: any[] = [];

  for (const part of (candidate.content?.parts || [])) {
    if (part.text) {
      textContent += part.text;
    } else if (part.inlineData) {
      // Convert Gemini's inlineData to the expected format
      const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      images.push({
        type: 'image_url',
        image_url: { url: dataUrl }
      });
    }
  }

  const reshapedResponse = {
    choices: [{
      message: {
        role: 'assistant',
        content: textContent || 'Image generated successfully.',
        images
      }
    }]
  };

  return new Response(JSON.stringify(reshapedResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
