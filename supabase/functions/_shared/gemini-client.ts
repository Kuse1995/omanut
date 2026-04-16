/**
 * Shared AI client for all edge functions.
 * Text/tool-calling models route through Zhipu (GLM), Gemini, DeepSeek, or Lovable AI Gateway based on model prefix.
 * Image/video generation always uses Gemini/OpenAI native APIs.
 */

const GEMINI_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const ZHIPU_OPENAI_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DEEPSEEK_OPENAI_URL = 'https://api.deepseek.com/v1/chat/completions';
const LOVABLE_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

/** Strip provider prefix from model names (e.g. "google/gemini-2.5-flash" → "gemini-2.5-flash") */
function normalizeModel(model: string): string {
  return model.replace(/^(google|openai)\//, '');
}

/** Determine provider from model name */
function getProvider(model: string): 'zhipu' | 'deepseek' | 'lovable' | 'gemini' {
  const normalized = normalizeModel(model);
  if (normalized.startsWith('glm-')) return 'zhipu';
  if (normalized.startsWith('deepseek')) return 'deepseek';
  if (normalized.startsWith('gemini-') || normalized.startsWith('gpt-')) return 'lovable';
  return 'gemini';
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
 * Call AI API for text/tool-calling models.
 * Routes GLM → Zhipu, DeepSeek → DeepSeek API, google/openai prefixed → Lovable Gateway, else Gemini direct.
 */
export async function geminiChat(options: GeminiChatOptions): Promise<Response> {
  const provider = getProvider(options.model);
  const normalizedModel = normalizeModel(options.model);

  let apiUrl: string;
  let apiKey: string | undefined;
  let modelToSend = normalizedModel;

  switch (provider) {
    case 'zhipu':
      apiUrl = ZHIPU_OPENAI_URL;
      apiKey = Deno.env.get('ZHIPU_API_KEY');
      if (!apiKey) throw new Error('ZHIPU_API_KEY is not configured');
      break;
    case 'deepseek':
      apiUrl = DEEPSEEK_OPENAI_URL;
      apiKey = Deno.env.get('DEEPSEEK_API_KEY');
      if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured');
      break;
    case 'lovable':
      apiUrl = LOVABLE_GATEWAY_URL;
      apiKey = Deno.env.get('LOVABLE_API_KEY');
      if (!apiKey) {
        // Fall back to direct Gemini if no Lovable key
        apiUrl = GEMINI_OPENAI_URL;
        apiKey = Deno.env.get('GEMINI_API_KEY');
        if (!apiKey) throw new Error('No API key available (LOVABLE_API_KEY or GEMINI_API_KEY)');
      } else {
        // Lovable gateway needs the full prefixed model name
        modelToSend = options.model.includes('/') ? options.model : `google/${normalizedModel}`;
      }
      break;
    default:
      apiUrl = GEMINI_OPENAI_URL;
      apiKey = Deno.env.get('GEMINI_API_KEY');
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
      break;
  }

  const body: any = {
    model: modelToSend,
    messages: options.messages,
  };

  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  if (options.tools) body.tools = options.tools;
  if (options.tool_choice) body.tool_choice = options.tool_choice;
  if (provider !== 'zhipu' && provider !== 'deepseek' && options.modalities) body.modalities = options.modalities;
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

  return fetch(apiUrl, fetchOptions);
}

/**
 * Call AI with automatic fallback chain: primary model → DeepSeek → Lovable Gateway.
 * Only for text/chat completions (not image gen). Returns the first successful response.
 */
export async function geminiChatWithFallback(options: GeminiChatOptions): Promise<Response> {
  const fallbackChain = [
    options.model,
    'deepseek-chat',
    'google/gemini-2.5-flash',
  ];

  // Deduplicate
  const seen = new Set<string>();
  const chain = fallbackChain.filter(m => {
    const key = normalizeModel(m);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      console.log(`[AI-FALLBACK] Trying model ${i + 1}/${chain.length}: ${model}`);
      const response = await geminiChat({ ...options, model });
      if (response.ok) {
        console.log(`[AI-FALLBACK] Success with model: ${model}`);
        return response;
      }
      const errText = await response.text();
      console.warn(`[AI-FALLBACK] Model ${model} failed (${response.status}): ${errText.substring(0, 200)}`);
    } catch (err) {
      console.warn(`[AI-FALLBACK] Model ${model} threw:`, err instanceof Error ? err.message : err);
    }
  }

  // All failed — return last attempt so caller gets an error response
  console.error('[AI-FALLBACK] All models in fallback chain failed');
  throw new Error('All AI models in fallback chain failed');
}

/**
 * Generate images using the native Gemini API (not OpenAI-compatible).
 * The OpenAI chat/completions endpoint doesn't support image generation for these models.
 * Supports optional input images for editing/product-anchored generation.
 */
export async function geminiImageGenerate(options: {
  model?: string;
  prompt: string;
  inputImageUrls?: string[];
}): Promise<{ imageBase64: string | null; text: string | null }> {
  // Try Lovable AI Gateway first (no quota issues), fall back to direct Gemini
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');

  if (!lovableKey && !geminiKey) {
    throw new Error('Neither LOVABLE_API_KEY nor GEMINI_API_KEY is configured');
  }

  // Build input content parts
  const contentParts: any[] = [{ type: 'text', text: options.prompt }];
  if (options.inputImageUrls && options.inputImageUrls.length > 0) {
    for (const imageUrl of options.inputImageUrls) {
      if (imageUrl.startsWith('data:')) {
        contentParts.push({ type: 'image_url', image_url: { url: imageUrl } });
      } else {
        try {
          const imgResponse = await fetch(imageUrl);
          if (imgResponse.ok) {
            const imgBuffer = await imgResponse.arrayBuffer();
            const bytes = new Uint8Array(imgBuffer);
            let imgBase64 = '';
            const chunkSize = 32768;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              imgBase64 += String.fromCharCode.apply(null, [...chunk]);
            }
            imgBase64 = btoa(imgBase64);
            const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
            contentParts.push({ type: 'image_url', image_url: { url: `data:${contentType};base64,${imgBase64}` } });
          }
        } catch (e) {
          console.error(`Failed to fetch input image: ${imageUrl}`, e);
        }
      }
    }
  }

  const model = normalizeModel(options.model || 'gemini-3-pro-image-preview');

  // Strategy 1: Lovable AI Gateway (preferred — no quota issues)
  if (lovableKey) {
    try {
      console.log('[IMAGE-GEN] Using Lovable AI Gateway for image generation');
      const gatewayResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: `google/${model}`,
          messages: [{ role: 'user', content: contentParts.length === 1 ? options.prompt : contentParts }],
          modalities: ['image', 'text'],
        }),
      });

      if (gatewayResponse.ok) {
        const data = await gatewayResponse.json();
        const message = data.choices?.[0]?.message;
        let imageBase64: string | null = null;
        let text: string | null = message?.content || null;

        if (message?.images && message.images.length > 0) {
          imageBase64 = message.images[0].image_url?.url || null;
        }

        if (imageBase64) {
          console.log('[IMAGE-GEN] Lovable AI Gateway image generation successful');
          return { imageBase64, text };
        }
      } else {
        const errText = await gatewayResponse.text();
        console.warn(`[IMAGE-GEN] Lovable AI Gateway failed (${gatewayResponse.status}): ${errText.substring(0, 200)}`);
      }
    } catch (e) {
      console.warn('[IMAGE-GEN] Lovable AI Gateway error:', e);
    }
  }

  // Strategy 2: Direct Gemini API (fallback)
  if (!geminiKey) {
    throw new Error('Image generation failed via Lovable AI Gateway and GEMINI_API_KEY is not available as fallback');
  }

  console.log('[IMAGE-GEN] Falling back to direct Gemini API');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

  // Build native Gemini parts
  const parts: any[] = [{ text: options.prompt }];
  if (options.inputImageUrls && options.inputImageUrls.length > 0) {
    for (const imageUrl of options.inputImageUrls) {
      if (imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      } else {
        try {
          const imgResponse = await fetch(imageUrl);
          if (imgResponse.ok) {
            const imgBuffer = await imgResponse.arrayBuffer();
            const bytes = new Uint8Array(imgBuffer);
            let imgBase64 = '';
            const chunkSize = 32768;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              imgBase64 += String.fromCharCode.apply(null, [...chunk]);
            }
            imgBase64 = btoa(imgBase64);
            const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
            parts.push({ inlineData: { mimeType: contentType, data: imgBase64 } });
          }
        } catch (e) {
          console.error(`Failed to fetch input image: ${imageUrl}`, e);
        }
      }
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
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
  const responseParts = data.candidates?.[0]?.content?.parts || [];

  let imageBase64: string | null = null;
  let text: string | null = null;

  for (const part of responseParts) {
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
 * Generate images using OpenAI's native Images API (gpt-image-1.5).
 * Drop-in replacement for geminiImageGenerate — same return signature.
 */
export async function openaiImageGenerate(options: {
  prompt: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
}): Promise<{ imageBase64: string | null; text: string | null }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: options.prompt,
      n: 1,
      size: options.size || '1024x1024',
      quality: options.quality || 'high',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`OpenAI image gen error (${response.status}):`, errText);
    throw Object.assign(new Error(`Image generation failed: ${response.status}`), { status: response.status });
  }

  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;

  if (!b64) {
    return { imageBase64: null, text: null };
  }

  return { imageBase64: `data:image/png;base64,${b64}`, text: null };
}

/**
 * Edit/transform images using OpenAI's Images Edit API (gpt-image-1.5).
 * Supports input images for product-anchored generation and edit flows.
 */
export async function openaiImageEdit(options: {
  prompt: string;
  inputImageUrls: string[];
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
}): Promise<{ imageBase64: string | null; text: string | null }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  // Build multipart form data
  const formData = new FormData();
  formData.append('model', 'gpt-image-1');
  formData.append('prompt', options.prompt);
  formData.append('n', '1');
  formData.append('size', options.size || '1024x1024');
  formData.append('quality', options.quality || 'high');

  // Fetch and attach input images
  for (let i = 0; i < options.inputImageUrls.length; i++) {
    const imageUrl = options.inputImageUrls[i];
    try {
      let imageBlob: Blob;
      if (imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
          imageBlob = new Blob([bytes], { type: match[1] });
        } else continue;
      } else {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        imageBlob = await imgResponse.blob();
      }
      // Convert to PNG blob for OpenAI compatibility
      formData.append('image[]', imageBlob, `input_${i}.png`);
    } catch (e) {
      console.error(`Failed to fetch input image ${i}:`, e);
    }
  }

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`OpenAI image edit error (${response.status}):`, errText);
    throw Object.assign(new Error(`Image edit failed: ${response.status}`), { status: response.status });
  }

  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;

  if (!b64) {
    return { imageBase64: null, text: null };
  }

  return { imageBase64: `data:image/png;base64,${b64}`, text: null };
}

/**
 * Start a Veo video generation operation (fire-and-forget).
 * Returns the operation name for later polling. Does NOT wait for completion.
 */
export async function veoStartGeneration(options: {
  prompt: string;
  model?: string;
  inputImageUrl?: string;
  durationSeconds?: number;
  aspectRatio?: string;
}): Promise<{ operationName: string }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = normalizeModel(options.model || 'veo-3.1-fast-generate-preview');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;

  const instance: any = { prompt: options.prompt };

  if (options.inputImageUrl) {
    try {
      let imgBase64: string;
      if (options.inputImageUrl.startsWith('data:')) {
        const match = options.inputImageUrl.match(/^data:image\/\w+;base64,(.+)$/);
        imgBase64 = match ? match[1] : '';
      } else {
        const imgResponse = await fetch(options.inputImageUrl);
        if (imgResponse.ok) {
          const imgBuffer = await imgResponse.arrayBuffer();
          const bytes = new Uint8Array(imgBuffer);
          let raw = '';
          const chunkSize = 32768;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            raw += String.fromCharCode.apply(null, [...chunk]);
          }
          imgBase64 = btoa(raw);
        } else {
          imgBase64 = '';
        }
      }
      if (imgBase64) {
        instance.image = { bytesBase64Encoded: imgBase64 };
      }
    } catch (e) {
      console.error('Failed to fetch input image for Veo:', e);
    }
  }

  const body = {
    instances: [instance],
    parameters: {
      sampleCount: 1,
      durationSeconds: options.durationSeconds || 8,
      aspectRatio: options.aspectRatio || '9:16',
    },
  };

  console.log(`[VEO] Starting video generation: model=${model}, hasImage=${!!instance.image}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[VEO] Start error (${response.status}):`, errText);
    throw new Error(`Veo API error: ${response.status} - ${errText}`);
  }

  const opData = await response.json();
  const operationName = opData.name;
  if (!operationName) {
    console.error('[VEO] No operation name returned:', opData);
    throw new Error('No operation name from Veo');
  }

  console.log(`[VEO] Operation started: ${operationName}`);
  return { operationName };
}

/**
 * Poll a Veo operation once. Returns video data if done, null if still pending.
 */
export async function veoPollOperation(operationName: string): Promise<{
  done: boolean;
  videoBase64: string | null;
  mimeType: string | null;
  error?: string;
}> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
  const pollRes = await fetch(pollUrl, {
    headers: { 'x-goog-api-key': apiKey },
  });

  if (!pollRes.ok) {
    const errText = await pollRes.text();
    console.error(`[VEO] Poll error (${pollRes.status}):`, errText);

    if (pollRes.status >= 400 && pollRes.status < 500) {
      return {
        done: true,
        videoBase64: null,
        mimeType: null,
        error: `Veo poll error ${pollRes.status}: ${errText}`,
      };
    }

    return { done: false, videoBase64: null, mimeType: null };
  }

  const pollData = await pollRes.json();

  if (pollData.error) {
    return { done: true, videoBase64: null, mimeType: null, error: pollData.error.message || 'Veo generation error' };
  }

  if (!pollData.done) {
    return { done: false, videoBase64: null, mimeType: null };
  }

  // Extract video data
  const videos = pollData.response?.generateVideoResponse?.generatedSamples
    || pollData.response?.videos
    || [];

  if (videos.length > 0) {
    const video = videos[0];
    const videoB64 = video.video?.bytesBase64Encoded || video.bytesBase64Encoded;
    const mime = video.video?.mimeType || video.mimeType || 'video/mp4';
    if (videoB64) {
      return { done: true, videoBase64: videoB64, mimeType: mime };
    }

    // URI-based response
    if (video.video?.uri) {
      try {
        const vidRes = await fetch(video.video.uri, {
          headers: { 'x-goog-api-key': apiKey },
        });
        if (vidRes.ok) {
          const vidBuffer = await vidRes.arrayBuffer();
          const bytes = new Uint8Array(vidBuffer);
          let raw = '';
          const chunkSize = 32768;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            raw += String.fromCharCode.apply(null, [...chunk]);
          }
          return { done: true, videoBase64: btoa(raw), mimeType: 'video/mp4' };
        }
      } catch (e) {
        console.error('[VEO] Failed to download video from URI:', e);
      }
    }
  }

  return { done: true, videoBase64: null, mimeType: null, error: 'No video data in response' };
}

/**
 * Generate video using Google Veo API (predictLongRunning).
 * Supports text-to-video and image-to-video (pass inputImageUrl for i2v).
 * Returns a public URL to the generated video stored in Supabase storage.
 * @deprecated Use veoStartGeneration + veoPollOperation for async pipeline.
 */
export async function veoGenerateVideo(options: {
  prompt: string;
  model?: string;
  inputImageUrl?: string;
  durationSeconds?: number;
  aspectRatio?: string;
}): Promise<{ videoBase64: string | null; mimeType: string | null; error?: string }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = normalizeModel(options.model || 'veo-3.1-fast-generate-preview');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;

  // Build instance
  const instance: any = { prompt: options.prompt };

  // Image-to-video: fetch image and embed as base64
  if (options.inputImageUrl) {
    try {
      let imgBase64: string;
      if (options.inputImageUrl.startsWith('data:')) {
        const match = options.inputImageUrl.match(/^data:image\/\w+;base64,(.+)$/);
        imgBase64 = match ? match[1] : '';
      } else {
        const imgResponse = await fetch(options.inputImageUrl);
        if (imgResponse.ok) {
          const imgBuffer = await imgResponse.arrayBuffer();
          const bytes = new Uint8Array(imgBuffer);
          let raw = '';
          const chunkSize = 32768;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            raw += String.fromCharCode.apply(null, [...chunk]);
          }
          imgBase64 = btoa(raw);
        } else {
          imgBase64 = '';
        }
      }
      if (imgBase64) {
        instance.image = { bytesBase64Encoded: imgBase64 };
      }
    } catch (e) {
      console.error('Failed to fetch input image for Veo:', e);
    }
  }

  const body = {
    instances: [instance],
    parameters: {
      sampleCount: 1,
      durationSeconds: options.durationSeconds || 8,
      aspectRatio: options.aspectRatio || '9:16',
    },
  };

  console.log(`[VEO] Starting video generation: model=${model}, hasImage=${!!instance.image}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[VEO] Start error (${response.status}):`, errText);
    return { videoBase64: null, mimeType: null, error: `Veo API error: ${response.status}` };
  }

  const opData = await response.json();
  const operationName = opData.name;
  if (!operationName) {
    console.error('[VEO] No operation name returned:', opData);
    return { videoBase64: null, mimeType: null, error: 'No operation name from Veo' };
  }

  console.log(`[VEO] Operation started: ${operationName}`);

  // Poll for completion (max ~4 minutes)
  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
  for (let attempt = 0; attempt < 48; attempt++) {
    await new Promise(r => setTimeout(r, 5000)); // 5s intervals

    const pollRes = await fetch(pollUrl, {
      headers: { 'x-goog-api-key': apiKey },
    });

    if (!pollRes.ok) {
      const errText = await pollRes.text();
      console.error(`[VEO] Poll error (${pollRes.status}):`, errText);
      continue;
    }

    const pollData = await pollRes.json();

    if (pollData.done) {
      console.log('[VEO] Generation complete');
      const videos = pollData.response?.generateVideoResponse?.generatedSamples
        || pollData.response?.videos
        || [];

      if (videos.length > 0) {
        const video = videos[0];
        const videoB64 = video.video?.bytesBase64Encoded || video.bytesBase64Encoded;
        const mime = video.video?.mimeType || video.mimeType || 'video/mp4';
        if (videoB64) {
          return { videoBase64: videoB64, mimeType: mime };
        }
      }

      // Check for URI-based response
      const uriVideos = pollData.response?.generateVideoResponse?.generatedSamples;
      if (uriVideos?.[0]?.video?.uri) {
        // Download the video from URI
        try {
          const vidRes = await fetch(uriVideos[0].video.uri, {
            headers: { 'x-goog-api-key': apiKey },
          });
          if (vidRes.ok) {
            const vidBuffer = await vidRes.arrayBuffer();
            const bytes = new Uint8Array(vidBuffer);
            let raw = '';
            const chunkSize = 32768;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              raw += String.fromCharCode.apply(null, [...chunk]);
            }
            return { videoBase64: btoa(raw), mimeType: 'video/mp4' };
          }
        } catch (e) {
          console.error('[VEO] Failed to download video from URI:', e);
        }
      }

      return { videoBase64: null, mimeType: null, error: 'No video data in response' };
    }

    if (pollData.error) {
      console.error('[VEO] Generation error:', pollData.error);
      return { videoBase64: null, mimeType: null, error: pollData.error.message || 'Veo generation error' };
    }
  }

  return { videoBase64: null, mimeType: null, error: 'Video generation timed out after 4 minutes' };
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
