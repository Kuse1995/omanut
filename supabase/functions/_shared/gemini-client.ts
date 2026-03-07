/**
 * Shared Gemini API client for all edge functions.
 * Replaces the Lovable AI Gateway with direct Google Gemini API calls.
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

  const model = normalizeModel(options.model);

  // Image generation models need native Gemini API
  if (isImageModel(model) && options.modalities?.includes('image')) {
    return geminiNativeImageCall(model, options, apiKey);
  }

  // Text models use OpenAI-compatible endpoint
  const body: any = {
    model,
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
 * Native Gemini API call for image generation models.
 * Converts the OpenAI-style request to Gemini's generateContent format,
 * then reshapes the response back to OpenAI format for compatibility.
 */
async function geminiNativeImageCall(
  model: string,
  options: GeminiChatOptions,
  apiKey: string,
): Promise<Response> {
  const url = `${GEMINI_NATIVE_URL}/${model}:generateContent?key=${apiKey}`;

  // Convert OpenAI messages to Gemini parts
  const contents: any[] = [];
  
  for (const msg of options.messages) {
    if (msg.role === 'system') {
      // Gemini doesn't have system role in generateContent; prepend to first user message
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: any[] = [];

    if (typeof msg.content === 'string') {
      // Prepend system message content if this is the first user message
      const systemMsg = options.messages.find(m => m.role === 'system');
      const prefix = systemMsg && role === 'user' ? `${systemMsg.content}\n\n` : '';
      parts.push({ text: prefix + msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image_url') {
          const imageUrl = part.image_url?.url || '';
          if (imageUrl.startsWith('data:')) {
            // Base64 inline data
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              parts.push({
                inline_data: {
                  mime_type: matches[1],
                  data: matches[2],
                },
              });
            }
          } else {
            // URL-based image — Gemini can handle URLs via fileData or we fetch and inline
            parts.push({ text: `[Image: ${imageUrl}]` });
          }
        }
      }
    }

    contents.push({ role, parts });
  }

  const body: any = {
    contents,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  if (options.temperature !== undefined) {
    body.generationConfig.temperature = options.temperature;
  }
  if (options.max_tokens !== undefined) {
    body.generationConfig.maxOutputTokens = options.max_tokens;
  }

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
    // Return the error response as-is so callers can handle status codes
    return response;
  }

  const data = await response.json();

  // Reshape native Gemini response to OpenAI-compatible format
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let textContent = '';
  const images: any[] = [];

  for (const part of parts) {
    if (part.text) {
      textContent += part.text;
    }
    if (part.inlineData) {
      const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      images.push({ image_url: { url: dataUrl } });
    }
  }

  const reshapedResponse = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: textContent,
          images: images.length > 0 ? images : undefined,
        },
      },
    ],
    usage: data.usageMetadata || {},
  };

  return new Response(JSON.stringify(reshapedResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
