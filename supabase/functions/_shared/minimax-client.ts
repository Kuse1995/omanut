/**
 * MiniMax Video Generation Client
 * Uses MiniMax Hailuo 2.6 Fast model for video generation.
 * API: https://api.minimax.io/v1/video_generation
 */

const MINIMAX_BASE = 'https://api.minimax.io/v1';

function getApiKey(): string {
  const key = Deno.env.get('MINIMAX_API_KEY');
  if (!key) throw new Error('MINIMAX_API_KEY is not configured');
  return key;
}

/**
 * Start a MiniMax video generation task.
 * Supports text-to-video and image-to-video modes.
 * Returns a task_id for polling.
 */
export async function minimaxStartVideoGeneration(options: {
  prompt: string;
  inputImageUrl?: string;
  aspectRatio?: string;
  model?: string;
}): Promise<{ taskId: string }> {
  const apiKey = getApiKey();
  const model = options.model || 'MiniMax-Hailuo-2.6-Fast';

  const payload: any = {
    model,
    prompt: options.prompt,
  };

  // Map aspect ratio to resolution
  // MiniMax supports: 720P, 1080P
  payload.resolution = '720P';

  if (options.inputImageUrl) {
    // Image-to-video mode
    payload.first_frame_image = options.inputImageUrl;
  }

  console.log(`[MINIMAX] Starting video generation: model=${model}, hasImage=${!!options.inputImageUrl}`);

  const response = await fetch(`${MINIMAX_BASE}/video_generation`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[MINIMAX] Start error (${response.status}):`, errText);
    throw new Error(`MiniMax API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();

  if (data.base_resp?.status_code !== 0 && data.base_resp?.status_code !== undefined) {
    console.error('[MINIMAX] API returned error:', data.base_resp);
    throw new Error(`MiniMax error: ${data.base_resp?.status_msg || 'Unknown error'}`);
  }

  const taskId = data.task_id;
  if (!taskId) {
    console.error('[MINIMAX] No task_id returned:', data);
    throw new Error('No task_id from MiniMax');
  }

  console.log(`[MINIMAX] Task started: ${taskId}`);
  return { taskId };
}

/**
 * Poll a MiniMax video generation task.
 * Returns file_id when done, null if still processing.
 */
export async function minimaxPollVideoTask(taskId: string): Promise<{
  done: boolean;
  fileId: string | null;
  downloadUrl: string | null;
  error: string | null;
}> {
  const apiKey = getApiKey();

  const response = await fetch(`${MINIMAX_BASE}/query/video_generation?task_id=${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[MINIMAX] Poll error (${response.status}):`, errText);
    if (response.status >= 400 && response.status < 500) {
      return { done: true, fileId: null, downloadUrl: null, error: `MiniMax poll error ${response.status}: ${errText}` };
    }
    return { done: false, fileId: null, downloadUrl: null, error: null };
  }

  const data = await response.json();

  if (data.base_resp?.status_code !== 0 && data.base_resp?.status_code !== undefined) {
    return { done: true, fileId: null, downloadUrl: null, error: data.base_resp?.status_msg || 'Unknown error' };
  }

  const status = data.status;
  console.log(`[MINIMAX] Poll status for ${taskId}: ${status}`);

  if (status === 'Success') {
    const fileId = data.file_id;
    // MiniMax may also return a download URL directly
    const downloadUrl = data.file?.download_url || null;
    return { done: true, fileId, downloadUrl, error: null };
  }

  if (status === 'Fail' || status === 'Failed') {
    return { done: true, fileId: null, downloadUrl: null, error: data.base_resp?.status_msg || 'Video generation failed' };
  }

  // Still processing (Queueing, Processing, Preparing, etc.)
  return { done: false, fileId: null, downloadUrl: null, error: null };
}

/**
 * Download a video file from MiniMax by file_id.
 * Returns the raw video bytes.
 */
export async function minimaxDownloadFile(fileId: string): Promise<{ videoBytes: Uint8Array; mimeType: string }> {
  const apiKey = getApiKey();

  const response = await fetch(`${MINIMAX_BASE}/files/retrieve?file_id=${fileId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiniMax download error: ${response.status} - ${errText}`);
  }

  const contentType = response.headers.get('content-type') || 'video/mp4';
  const buffer = await response.arrayBuffer();
  return { videoBytes: new Uint8Array(buffer), mimeType: contentType };
}
