// Publishes one claimed scheduled_posts row whose target_platform is linkedin or tiktok.
// Used by publish-meta-post (which cron-publisher calls for every approved, due post).
// Company and account come only from the row; the token is looked up by (company_id, platform,
// account_id = row.page_id), so a post can never go out on another company's account.
import { redactSecrets } from "./mcp-safety.ts";
import { ensureFreshTikTokToken, tokenStatusFromExpiry } from "./social-oauth.ts";
import { postToLinkedIn, postToTikTok, rowStatusForTikTok } from "./social-publish.ts";

type Result = { ok: boolean; status: string; meta_post_id?: string | null; post_url?: string | null; error?: string };

export async function publishScheduledSocialPost(supabase: any, post: any): Promise<Result> {
  const platform = String(post.target_platform) as "linkedin" | "tiktok";
  const meta = (post.metadata && typeof post.metadata === "object") ? post.metadata : {};
  const now = () => new Date().toISOString();
  const fail = async (message: string): Promise<Result> => {
    const clean = redactSecrets(message).slice(0, 1000);
    await supabase.from("scheduled_posts").update({ status: "failed", error_message: clean, updated_at: now() }).eq("id", post.id);
    return { ok: false, status: "failed", error: clean };
  };

  const { data: company } = await supabase.from("companies").select("name, test_mode").eq("id", post.company_id).maybeSingle();
  if (!company) return fail("Company not found for this post.");
  if (company.test_mode === true && meta.forced_test_mode_publish !== true) {
    return fail(`blocked_by_test_mode: Test mode is on for ${company.name}, so this ${platform} post was not published. Schedule it with force: true, or turn test mode off.`);
  }

  const { data: cred } = await supabase
    .from("social_credentials")
    .select("id, account_id, access_token, refresh_token, token_expires_at, refresh_expires_at, environment")
    .eq("company_id", post.company_id)
    .eq("platform", platform)
    .eq("account_id", post.page_id)
    .maybeSingle();
  if (!cred?.access_token) return fail(`The ${platform === "linkedin" ? "LinkedIn" : "TikTok"} account this post was scheduled for is no longer connected.`);

  try {
    if (platform === "linkedin") {
      if (tokenStatusFromExpiry(cred.token_expires_at) === "expired") return fail("LinkedIn token has expired; reconnect LinkedIn.");
      const { urn, post_url } = await postToLinkedIn(cred, {
        commentary: String(post.content || ""),
        imageUrl: post.image_url || (Array.isArray(post.image_urls) ? post.image_urls[0] : null) || null,
        articleUrl: typeof meta.article_url === "string" ? meta.article_url : null,
        visibility: meta.visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
      });
      await supabase.from("scheduled_posts").update({
        status: "published", meta_post_id: urn, error_message: null, updated_at: now(),
        metadata: { ...meta, post_url, published_via: "scheduler" },
      }).eq("id", post.id);
      return { ok: true, status: "published", meta_post_id: urn, post_url };
    }

    const fresh = await ensureFreshTikTokToken(supabase, cred);
    if (fresh.error && tokenStatusFromExpiry(fresh.cred.token_expires_at) !== "valid") return fail(fresh.error);
    const photos: string[] = Array.isArray(post.image_urls) && post.image_urls.length ? post.image_urls : (post.image_url ? [post.image_url] : []);
    const mediaType = post.video_url ? "video" : "photo";
    const sent = await postToTikTok(fresh.cred.access_token, {
      caption: String(post.content || ""),
      mode: meta.mode === "direct" ? "direct" : "draft",
      mediaType,
      videoUrl: post.video_url || null,
      photoUrls: mediaType === "photo" ? photos : null,
      privacy: cred.environment === "sandbox" ? "SELF_ONLY" : (typeof meta.privacy_level === "string" ? meta.privacy_level : "SELF_ONLY"),
      disable_comment: false, disable_duet: false, disable_stitch: false,
    });
    const status = rowStatusForTikTok(sent.tiktokStatus);
    await supabase.from("scheduled_posts").update({
      status,
      meta_post_id: sent.publishId,
      error_message: sent.tiktokStatus === "FAILED" ? (sent.failReason || "TikTok reported FAILED") : null,
      metadata: { ...meta, tiktok_publish_id: sent.publishId, tiktok_status: sent.tiktokStatus, published_via: "scheduler" },
      updated_at: now(),
    }).eq("id", post.id);
    return { ok: sent.tiktokStatus !== "FAILED", status, meta_post_id: sent.publishId, ...(sent.failReason ? { error: sent.failReason } : {}) };
  } catch (e: any) {
    return fail(e?.message || String(e));
  }
}
