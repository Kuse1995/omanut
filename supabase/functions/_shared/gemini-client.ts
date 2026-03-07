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
  const model = options.model; // Keep original model name for Gateway calls

  // Image generation models route through Lovable AI Gateway
  if (isImageModel(model)) {
    return lovableGatewayImageCall(model, options);
  }

  // Text models use direct Gemini OpenAI-compatible endpoint
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const normalizedModel = normalizeModel(model);

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
 * Route image generation models through the Lovable AI Gateway.
 * The Gateway handles these model aliases (e.g. google/gemini-3-pro-image-preview)
 * and returns images in the OpenAI-compatible format with an `images` array.
 */
async function lovableGatewayImageCall(
  model: string,
  options: GeminiChatOptions,
): Promise<Response> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    throw new Error('LOVABLE_API_KEY is not configured — required for image generation');
  }

  // Ensure model has provider prefix for the Gateway
  const gatewayModel = model.includes('/') ? model : `google/${model}`;

  const body: any = {
    model: gatewayModel,
    messages: options.messages,
  };

  if (options.modalities) body.modalities = options.modalities;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };

  if (options.signal) {
    fetchOptions.signal = options.signal;
  }

  console.log(`[gemini-client] Routing image model "${gatewayModel}" through Lovable Gateway`);

  return fetch('https://ai.gateway.lovable.dev/v1/chat/completions', fetchOptions);
}
