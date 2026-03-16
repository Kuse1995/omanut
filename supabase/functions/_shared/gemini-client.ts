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
 * Supports optional input images for editing/product-anchored generation.
 */
export async function geminiImageGenerate(options: {
  model?: string;
  prompt: string;
  inputImageUrls?: string[];
}): Promise<{ imageBase64: string | null; text: string | null }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = normalizeModel(options.model || 'gemini-3-pro-image-preview');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build parts array: text + optional input images
  const parts: any[] = [{ text: options.prompt }];

  if (options.inputImageUrls && options.inputImageUrls.length > 0) {
    for (const imageUrl of options.inputImageUrls) {
      if (imageUrl.startsWith('data:')) {
        // Base64 data URI
        const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      } else {
        // Fetch remote image and convert to base64 (chunked to avoid stack overflow)
        try {
          const imgResponse = await fetch(imageUrl);
          if (imgResponse.ok) {
            const imgBuffer = await imgResponse.arrayBuffer();
            // Convert in chunks to avoid RangeError on large images
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
 * Generate video using Google Veo API (predictLongRunning).
 * Supports text-to-video and image-to-video (pass inputImageUrl for i2v).
 * Returns a public URL to the generated video stored in Supabase storage.
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

  const model = normalizeModel(options.model || 'veo-3.0-fast-generate-preview');
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
