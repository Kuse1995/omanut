// Authenticated TikTok creator info, Direct Post / Inbox Draft publish, and status polling
// for Omanut's Content Scheduler web UI (meets TikTok Content Sharing & Direct Post UX Guidelines).
import { redactSecrets } from "../_shared/mcp-safety.ts";
import { ensureFreshTikTokToken, tokenStatusFromExpiry } from "../_shared/social-oauth.ts";
import { authUserId, canManageSocial, corsHeaders, json, jsonError, serviceClient } from "../_shared/social-oauth-server.ts";
import { fetchTikTokPublishStatus, postToTikTok, rowStatusForTikTok, tiktokFetch, tiktokPostUrl } from "../_shared/social-publish.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "POST only");
  try {
    const userId = await authUserId(req);
    if (!userId) return jsonError(401, "Sign in first.", "unauthorized");

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";
    const companyId = typeof body?.company_id === "string" ? body.company_id : "";
    if (!UUID.test(companyId)) return jsonError(400, "company_id must be a UUID.", "invalid_field");

    const supabase = serviceClient();
    if (!(await canManageSocial(supabase, userId, companyId))) {
      return jsonError(403, "Only company owners, managers, or platform admins can publish to TikTok.", "forbidden");
    }

    const { data: rawCred, error: credErr } = await supabase
      .from("social_credentials")
      .select("id, account_id, account_name, access_token, refresh_token, token_expires_at, refresh_expires_at, scopes, environment")
      .eq("company_id", companyId)
      .eq("platform", "tiktok")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (credErr) return jsonError(500, `Could not read TikTok connection: ${credErr.message}`, "internal");
    if (!rawCred?.access_token) {
      if (action === "creator_info") return json(200, { ok: true, connected: false });
      return jsonError(404, "No TikTok account is connected for this business. Connect TikTok in Setup first.", "not_found");
    }

    const fresh = await ensureFreshTikTokToken(supabase, rawCred as any);
    const cred = fresh.cred as any;
    if (fresh.error && tokenStatusFromExpiry(cred.token_expires_at) !== "valid") {
      return jsonError(401, fresh.error, "token_expired");
    }

    if (action === "creator_info") {
      const info = await tiktokFetch("/v2/post/publish/creator_info/query/", cred.access_token, {});
      if (!info.ok) {
        const expired = info.code === "access_token_invalid" || info.status === 401;
        return jsonError(expired ? 401 : 400, `Could not load TikTok creator info: ${info.code}${info.message ? ` - ${info.message}` : ""}`, expired ? "token_expired" : "platform_refused");
      }
      return json(200, {
        ok: true,
        connected: true,
        environment: cred.environment,
        account_name: cred.account_name,
        open_id: cred.account_id,
        creator: info.data,
      });
    }

    if (action === "status") {
      const publishId = typeof body?.publish_id === "string" ? body.publish_id.trim() : "";
      if (!/^[A-Za-z0-9_.~-]{4,200}$/.test(publishId)) {
        return jsonError(400, "Invalid publish_id.", "invalid_field");
      }
      const st = await fetchTikTokPublishStatus(cred.access_token, publishId);
      if (!st.checkOk) {
        return jsonError(400, `TikTok status check failed: ${st.checkError}`, "platform_refused");
      }
      const username = typeof body?.creator_username === "string" ? body.creator_username : null;
      const postUrl = tiktokPostUrl(username, st.publicPostIds[0]);
      const { data: row } = await supabase
        .from("scheduled_posts")
        .select("id, metadata")
        .eq("company_id", companyId)
        .eq("meta_post_id", publishId)
        .eq("target_platform", "tiktok")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (row) {
        await supabase.from("scheduled_posts").update({
          status: rowStatusForTikTok(st.tiktokStatus),
          error_message: st.tiktokStatus === "FAILED" ? (st.failReason || "TikTok reported FAILED") : null,
          metadata: {
            ...((row.metadata as any) || {}),
            tiktok_status: st.tiktokStatus,
            ...(st.failReason ? { tiktok_fail_reason: st.failReason } : {}),
            ...(postUrl ? { post_url: postUrl } : {}),
            status_checked_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
      return json(200, {
        ok: true,
        publish_id: publishId,
        status: st.tiktokStatus,
        fail_reason: st.failReason,
        post_url: postUrl,
        public_post_ids: st.publicPostIds,
      });
    }

    if (action === "publish") {
      const mode: "direct" | "draft" = body?.mode === "direct" ? "direct" : "draft";
      const videoUrl = typeof body?.video_url === "string" ? body.video_url.trim() : "";
      const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
      const privacyLevel = typeof body?.privacy_level === "string" ? body.privacy_level : "";
      const disableComment = Boolean(body?.disable_comment);
      const disableDuet = Boolean(body?.disable_duet);
      const disableStitch = Boolean(body?.disable_stitch);
      const brandOrganicToggle = Boolean(body?.brand_organic_toggle);
      const brandContentToggle = Boolean(body?.brand_content_toggle);

      if (!/^https:\/\//i.test(videoUrl)) return jsonError(400, "Select or upload a video first.", "invalid_field");
      if (caption.length > 2200) return jsonError(400, "Caption must be 2200 characters or fewer.", "invalid_field");
      if (mode === "direct") {
        const validPrivacy = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
        if (!validPrivacy.includes(privacyLevel)) {
          return jsonError(400, "Choose a privacy level before publishing directly to TikTok.", "invalid_field");
        }
        if (brandContentToggle && privacyLevel === "SELF_ONLY") {
          return jsonError(400, "Branded content visibility cannot be set to private (Only me).", "invalid_field");
        }
      }

      const effectivePrivacy = mode === "direct" ? privacyLevel : "SELF_ONLY";
      const { data: postRow, error: insErr } = await supabase.from("scheduled_posts").insert({
        company_id: companyId,
        page_id: cred.account_id,
        content: caption || "(TikTok draft video)",
        video_url: videoUrl,
        target_platform: "tiktok",
        scheduled_time: new Date().toISOString(),
        status: "publishing",
        created_by: userId,
        metadata: {
          source: "web_tiktok_direct",
          mode,
          media_type: "video",
          privacy_level: effectivePrivacy,
          environment: cred.environment,
          brand_organic_toggle: brandOrganicToggle,
          brand_content_toggle: brandContentToggle,
        },
      }).select("id, metadata").single();
      if (insErr || !postRow) {
        return jsonError(500, `Could not record the post: ${insErr?.message || "unknown"}`, "internal");
      }

      try {
        const sent = await postToTikTok(cred.access_token, {
          caption,
          mode,
          mediaType: "video",
          videoUrl,
          privacy: effectivePrivacy,
          disable_comment: disableComment,
          disable_duet: disableDuet,
          disable_stitch: disableStitch,
          brand_organic_toggle: brandOrganicToggle,
          brand_content_toggle: brandContentToggle,
        });
        const rowStatus = rowStatusForTikTok(sent.tiktokStatus);
        await supabase.from("scheduled_posts").update({
          status: rowStatus,
          meta_post_id: sent.publishId,
          error_message: sent.tiktokStatus === "FAILED" ? (sent.failReason || "TikTok reported FAILED") : null,
          metadata: {
            ...((postRow.metadata as any) || {}),
            tiktok_publish_id: sent.publishId,
            tiktok_status: sent.tiktokStatus,
            ...(sent.failReason ? { tiktok_fail_reason: sent.failReason } : {}),
          },
          updated_at: new Date().toISOString(),
        }).eq("id", postRow.id);

        return json(200, {
          ok: sent.tiktokStatus !== "FAILED",
          publish_id: sent.publishId,
          tiktok_status: sent.tiktokStatus,
          fail_reason: sent.failReason,
          mode,
          scheduled_post_id: postRow.id,
        });
      } catch (e: any) {
        const msg = redactSecrets(e?.message || String(e));
        await supabase.from("scheduled_posts").update({
          status: "failed",
          error_message: msg.slice(0, 1000),
          updated_at: new Date().toISOString(),
        }).eq("id", postRow.id);
        return jsonError(400, msg, e?.code || "platform_refused");
      }
    }

    return jsonError(400, "Unknown action. Use 'creator_info', 'publish', or 'status'.", "invalid_field");
  } catch (e: any) {
    console.error("[tiktok-web-publish]", redactSecrets(e?.message));
    return jsonError(500, e?.message || "Unexpected error", "internal");
  }
});
