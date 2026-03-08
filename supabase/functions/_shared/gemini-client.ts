/**
 * Shared Gemini API client for all edge functions.
 * 
 * Text models → Gemini OpenAI-compatible endpoint (GEMINI_API_KEY)
 * Image models → Lovable AI Gateway (LOVABLE_API_KEY)
 */

const GEMINI_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const LOVABLE_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

/** Strip provider prefix from model names (e.g. "google/gemini-2.5-flash" → "gemini-2.5-flash") */
function normalizeModel(model: string): string {
  return model.replace(/^(google|openai)\//, '');
}

/** Check if a model is an image-generation model that needs the Lovable Gateway */
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
 * Call AI API. Routes image models through Lovable AI Gateway, text models through direct Gemini.
 */
export async function geminiChat(options: GeminiChatOptions): Promise<Response> {
  const normalizedModel = normalizeModel(options.model);

  if (isImageModel(normalizedModel)) {
    return lovableGatewayImageCall(options);
  }

  // Text models use direct Gemini OpenAI-compatible endpoint
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

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
      throw Object.assign(new Error('API quota exceeded. Check your API plan.'), { status: 402 });
    }
    throw Object.assign(new Error(`API error: ${response.status}`), { status: response.status });
  }

  return response.json();
}

/**
 * Route image generation through Lovable AI Gateway.
 * The gateway supports image models like gemini-3.1-flash-image and gemini-3-pro-image-preview.
 * Returns OpenAI-compatible response with images array.
 */
async function lovableGatewayImageCall(options: GeminiChatOptions): Promise<Response> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    throw new Error('LOVABLE_API_KEY is not configured');
  }

  // Use the full model name with google/ prefix for the gateway
  const model = options.model.includes('/') ? options.model : `google/${options.model}`;
  
  console.log(`[gemini-client] Routing image model "${model}" through Lovable AI Gateway`);

  const body: any = {
    model,
    messages: options.messages,
  };

  if (options.modalities) body.modalities = options.modalities;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;

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

  return fetch(LOVABLE_GATEWAY_URL, fetchOptions);
}
