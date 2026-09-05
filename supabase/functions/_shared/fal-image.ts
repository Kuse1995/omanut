// fal.ai image generation — the PRIMARY image engine (same queue API as the
// Seedance video pipeline: submit -> poll -> result). One key, one bill, one
// provider for all generation. Gemini (geminiImageGenerate) remains the
// automatic fallback via generateImageSmart() below — never remove it.
//
// Models (env-overridable):
//   FAL_IMAGE_MODEL       text-to-image          default fal-ai/flux/dev
//   FAL_IMAGE_EDIT_MODEL  reference-image edits  default fal-ai/flux-pro/kontext
// FLUX Kontext is a reference-image editor — packshot in, on-brand ad out.

import { geminiImageGenerate } from "./gemini-client.ts";

const FAL_QUEUE_BASE = Deno.env.get("FAL_QUEUE_BASE") || "https://queue.fal.run";
const FAL_KEY = Deno.env.get("FAL_KEY") || "";
const FAL_IMAGE_MODEL = Deno.env.get("FAL_IMAGE_MODEL") || "fal-ai/flux/dev";
const FAL_IMAGE_EDIT_MODEL = Deno.env.get("FAL_IMAGE_EDIT_MODEL") || "fal-ai/flux-pro/kontext";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authHeaders(): Record<string, string> {
  return { Authorization: "Key " + FAL_KEY, "Content-Type": "application/json" };
}

async function toDataUri(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error("failed to download generated image: " + res.status);
  const mime = (res.headers.get("content-type") || "image/png").split(";")[0];
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return "data:" + mime + ";base64," + btoa(bin);
}

/** Generate an image on fal. Throws on failure — use generateImageSmart for
 *  the fal-first + Gemini-fallback wrapper with the same return shape as
 *  geminiImageGenerate ({ imageBase64, text }). */
export async function falImageGenerate(options: {
  prompt: string;
  inputImageUrls?: string[];
  imageSize?: string;
}): Promise<{ imageBase64: string; text: string | null; model: string }> {
  if (!FAL_KEY) throw new Error("FAL_KEY not configured");
  const isEdit = !!(options.inputImageUrls && options.inputImageUrls.length);
  const model = isEdit ? FAL_IMAGE_EDIT_MODEL : FAL_IMAGE_MODEL;
  const input: Record<string, unknown> = isEdit
    ? { prompt: options.prompt, image_url: options.inputImageUrls![0] }
    : { prompt: options.prompt, image_size: options.imageSize || "square_hd" };

  const submitRes = await fetch(FAL_QUEUE_BASE + "/" + model, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!submitRes.ok) {
    const t = await submitRes.text();
    throw new Error("fal submit failed (" + submitRes.status + "): " + t.slice(0, 200));
  }
  const submitJson: any = await submitRes.json();
  const statusUrl: string = submitJson.status_url || (FAL_QUEUE_BASE + "/" + model + "/requests/" + submitJson.request_id + "/status");
  const responseUrl: string = submitJson.response_url || (FAL_QUEUE_BASE + "/" + model + "/requests/" + submitJson.request_id);

  // Poll ~30s (images are fast); video has its own longer poller.
  let payload: any = null;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const stRes = await fetch(statusUrl, { headers: authHeaders() });
    const stJson: any = await stRes.json().catch(() => ({}));
    if (stJson.status === "COMPLETED") {
      const r = await fetch(responseUrl, { headers: authHeaders() });
      payload = await r.json();
      break;
    }
    if (stJson.status === "FAILED" || stJson.status === "ERROR") {
      throw new Error("fal image generation failed on the provider");
    }
  }
  if (!payload) throw new Error("fal image generation timed out");

  // Flexible output parse — fal response shapes vary slightly per model.
  const imageUrl: string | null =
    payload?.images?.[0]?.url || payload?.image?.url || payload?.url || payload?.output?.[0]?.url || null;
  if (!imageUrl) throw new Error("fal returned no image url");

  const imageBase64 = await toDataUri(imageUrl);
  return { imageBase64, text: null, model };
}

/** fal-first with Gemini fallback. Drop-in for geminiImageGenerate —
 *  same options and same { imageBase64, text } return shape. */
export async function generateImageSmart(options: {
  prompt: string;
  inputImageUrls?: string[];
  imageSize?: string;
}): Promise<{ imageBase64: string; text: string | null; source: string }> {
  const errors: string[] = [];
  if (FAL_KEY) {
    try {
      const r = await falImageGenerate(options);
      return { imageBase64: r.imageBase64, text: r.text, source: r.model };
    } catch (e: any) {
      errors.push("fal: " + (e?.message || e));
    }
  } else {
    errors.push("fal: FAL_KEY not configured");
  }
  try {
    const g = await geminiImageGenerate(options);
    if (g.imageBase64) return { imageBase64: g.imageBase64, text: g.text, source: "gemini" };
    errors.push("gemini: no image in response");
  } catch (e: any) {
    errors.push("gemini: " + (e?.message || e));
  }
  throw new Error("All image providers failed — " + errors.join(" | "));
}
