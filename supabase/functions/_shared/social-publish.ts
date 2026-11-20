// LinkedIn + TikTok publishing core shared by mcp-server (publish_* tools) and
// publish-meta-post (scheduled posts via cron-publisher). Callers own the test_mode gate,
// the scheduled_posts row and credential lookup; this module only talks to the platforms.
// Tokens go in the Authorization header only; every upstream message is run through redactSecrets.
import { McpToolError, redactSecrets } from "./mcp-safety.ts";
import { escapeLinkedInCommentary, socialConfig } from "./social-oauth.ts";

export const MAX_TIKTOK_VIDEO_BYTES = 64 * 1024 * 1024; // single-chunk FILE_UPLOAD limit
export const MAX_LINKEDIN_IMAGE_BYTES = 20 * 1024 * 1024;

/** Direct link to a LinkedIn post from the URN LinkedIn returns (urn:li:share:… / urn:li:ugcPost:…). */
export function linkedInPostUrl(urn: string): string {
  return "https://www.linkedin.com/feed/update/" + encodeURIComponent(urn);
}

/** Public TikTok link once a post is live; null until TikTok reports a public id. */
export function tiktokPostUrl(username: string | null | undefined, postId: string | number | null | undefined): string | null {
  if (!postId) return null;
  return username ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${postId}` : `https://www.tiktok.com/video/${postId}`;
}

export async function linkedInFetch(method: "GET" | "POST" | "DELETE", path: string, token: string, body?: unknown) {
  const cfg = socialConfig().linkedin;
  try {
    const res = await fetch(`https://api.linkedin.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Linkedin-Version": cfg.apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { ok: res.ok, status: res.status, body: parsed, headers: res.headers };
  } catch (e: any) {
    return { ok: false, status: 0, body: { message: e?.message || "network error" }, headers: new Headers() };
  }
}

export const linkedInReason = (r: { status: number; body: any }) =>
  redactSecrets((r.body && typeof r.body === "object" ? (r.body.message || r.body.error_description || r.body.error) : String(r.body || "").slice(0, 300)) || `HTTP ${r.status}`);

export async function tiktokFetch(path: string, token: string, body: unknown = {}) {
  try {
    const res = await fetch(`https://open.tiktokapis.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const j: any = await res.json().catch(() => ({}));
    const code = j?.error?.code ?? (res.ok ? "ok" : `http_${res.status}`);
    return { ok: res.ok && code === "ok", status: res.status, code, message: redactSecrets(j?.error?.message || ""), data: j?.data ?? null };
  } catch (e: any) {
    return { ok: false, status: 0, code: "network_error", message: redactSecrets(e?.message || "network error"), data: null };
  }
}

export type LinkedInPostInput = {
  commentary: string;
  imageUrl?: string | null;
  articleUrl?: string | null;
  articleTitle?: string | null;
  visibility?: "PUBLIC" | "CONNECTIONS";
};

/** Posts to LinkedIn as the connected member. Returns the post URN and its direct URL. */
export async function postToLinkedIn(cred: { account_id: string; access_token: string }, input: LinkedInPostInput) {
  const visibility = input.visibility || "PUBLIC";
  let content: Record<string, unknown> | undefined;
  if (input.imageUrl) {
    const img = await fetch(input.imageUrl, { redirect: "follow", signal: AbortSignal.timeout(20000) }).catch(() => null);
    const ct = img?.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    if (!img || img.status !== 200 || !ct.startsWith("image/")) {
      throw new McpToolError("invalid_field", `Image URL did not return an image (HTTP ${img?.status ?? "error"}, ${ct || "no content type"}).`, { field: "image_url" });
    }
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength > MAX_LINKEDIN_IMAGE_BYTES) throw new McpToolError("invalid_field", `Image is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit here is 20 MB.`, { field: "image_url" });
    const init = await linkedInFetch("POST", "/rest/images?action=initializeUpload", cred.access_token, { initializeUploadRequest: { owner: cred.account_id } });
    const uploadUrl = init.body?.value?.uploadUrl;
    const imageUrn = init.body?.value?.image;
    if (!init.ok || !uploadUrl || !imageUrn) throw new McpToolError("platform_refused", `LinkedIn refused the image upload: ${linkedInReason(init)}`, { details: { platform: "linkedin", http_status: init.status } });
    const put = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${cred.access_token}`, "Content-Type": ct }, body: bytes, signal: AbortSignal.timeout(60000) }).catch((e) => ({ ok: false, status: 0, statusText: String(e?.message || e) } as any));
    if (!put.ok) throw new McpToolError("platform_refused", `LinkedIn refused the image bytes: HTTP ${put.status}`, { details: { platform: "linkedin", http_status: put.status } });
    content = { media: { id: imageUrn } };
  } else if (input.articleUrl) {
    content = { article: { source: input.articleUrl, title: input.articleTitle || new URL(input.articleUrl).hostname } };
  }
  const res = await linkedInFetch("POST", "/rest/posts", cred.access_token, {
    author: cred.account_id,
    commentary: escapeLinkedInCommentary(input.commentary),
    visibility,
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(content ? { content } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  });
  const urn = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id");
  if (!res.ok || !urn) throw new McpToolError("platform_refused", `LinkedIn refused the post: ${linkedInReason(res)}`, { details: { platform: "linkedin", http_status: res.status } });
  return { urn, post_url: linkedInPostUrl(urn) };
}

export type TikTokPostInput = {
  caption: string;
  mode: "draft" | "direct";
  mediaType: "video" | "photo";
  videoUrl?: string | null;
  photoUrls?: string[] | null;
  privacy: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  brand_organic_toggle?: boolean;
  brand_content_toggle?: boolean;
};

/** Uploads to TikTok (inbox draft or direct post), then reads the first status. */
export async function postToTikTok(token: string, input: TikTokPostInput) {
  let publishId: string | null = null;
  if (input.mediaType === "video") {
    const vid = await fetch(input.videoUrl!, { redirect: "follow", signal: AbortSignal.timeout(60000) }).catch(() => null);
    const ct = vid?.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    if (!vid || vid.status !== 200 || !ct.startsWith("video/")) throw new McpToolError("invalid_field", `Video URL did not return a video (HTTP ${vid?.status ?? "error"}, ${ct || "no content type"}).`, { field: "video_url" });
    const declared = Number(vid.headers.get("content-length")) || 0;
    if (declared > MAX_TIKTOK_VIDEO_BYTES) { try { await vid.body?.cancel(); } catch { /* ignore */ } throw new McpToolError("invalid_field", `Video is ${(declared / 1048576).toFixed(1)} MB; the limit here is 64 MB.`, { field: "video_url" }); }
    const bytes = new Uint8Array(await vid.arrayBuffer());
    if (bytes.byteLength > MAX_TIKTOK_VIDEO_BYTES) throw new McpToolError("invalid_field", `Video is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit here is 64 MB.`, { field: "video_url" });
    const source_info = { source: "FILE_UPLOAD", video_size: bytes.byteLength, chunk_size: bytes.byteLength, total_chunk_count: 1 };
    const directPostInfo: Record<string, unknown> = {
      title: input.caption,
      privacy_level: input.privacy,
      disable_comment: input.disable_comment,
      disable_duet: input.disable_duet,
      disable_stitch: input.disable_stitch,
      ...(input.brand_organic_toggle ? { brand_organic_toggle: true } : {}),
      ...(input.brand_content_toggle ? { brand_content_toggle: true } : {}),
    };
    const init = input.mode === "draft"
      ? await tiktokFetch("/v2/post/publish/inbox/video/init/", token, { source_info })
      : await tiktokFetch("/v2/post/publish/video/init/", token, { post_info: directPostInfo, source_info });
    if (!init.ok || !init.data?.upload_url) throw new McpToolError("platform_refused", `TikTok refused the upload: ${init.code}${init.message ? ` - ${init.message}` : ""}`, { details: { platform: "tiktok", tiktok_code: init.code, http_status: init.status } });
    publishId = init.data.publish_id;
    const put = await fetch(init.data.upload_url, {
      method: "PUT",
      headers: { "Content-Type": ct, "Content-Length": String(bytes.byteLength), "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` },
      body: bytes,
      signal: AbortSignal.timeout(120000),
    }).catch((e) => ({ ok: false, status: 0, statusText: String(e?.message || e) } as any));
    if (!put.ok) throw new McpToolError("platform_refused", `TikTok refused the video bytes: HTTP ${put.status}`, { details: { platform: "tiktok", http_status: put.status, publish_id: publishId } });
  } else {
    const firstLine = input.caption.split("\n")[0].slice(0, 90);
    const init = await tiktokFetch("/v2/post/publish/content/init/", token, {
      post_info: input.mode === "direct"
        ? { title: firstLine, description: input.caption, privacy_level: input.privacy, disable_comment: input.disable_comment, auto_add_music: true }
        : { title: firstLine, description: input.caption },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: input.photoUrls },
      post_mode: input.mode === "direct" ? "DIRECT_POST" : "MEDIA_UPLOAD",
      media_type: "PHOTO",
    });
    if (!init.ok || !init.data?.publish_id) throw new McpToolError("platform_refused", `TikTok refused the photo post: ${init.code}${init.message ? ` - ${init.message}` : ""}`, { details: { platform: "tiktok", tiktok_code: init.code, http_status: init.status } });
    publishId = init.data.publish_id;
  }
  const status = await fetchTikTokPublishStatus(token, publishId!);
  return { publishId: publishId!, ...status };
}

/** Maps a TikTok publish status onto scheduled_posts.status. */
export function rowStatusForTikTok(tiktokStatus: string): string {
  return tiktokStatus === "PUBLISH_COMPLETE" ? "published" : tiktokStatus === "SEND_TO_USER_INBOX" ? "sent_to_inbox" : tiktokStatus === "FAILED" ? "failed" : "processing";
}

/** Reads /v2/post/publish/status/fetch/. TikTok's field is spelled publicaly_available_post_id. */
export async function fetchTikTokPublishStatus(token: string, publishId: string) {
  const st = await tiktokFetch("/v2/post/publish/status/fetch/", token, { publish_id: publishId });
  const tiktokStatus: string = st.data?.status || (st.ok ? "UNKNOWN" : `status_check_failed:${st.code}`);
  const ids: unknown = st.data?.publicaly_available_post_id;
  const publicIds = Array.isArray(ids) ? ids.map((x) => String(x)) : [];
  return {
    tiktokStatus,
    failReason: st.data?.fail_reason ? redactSecrets(st.data.fail_reason) : null,
    publicPostIds: publicIds,
    uploadedBytes: typeof st.data?.uploaded_bytes === "number" ? st.data.uploaded_bytes : null,
    checkOk: st.ok,
    checkError: st.ok ? null : `${st.code}${st.message ? `: ${st.message}` : ""}`,
  };
}
