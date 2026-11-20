import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Music2,
  RefreshCw,
  Send,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/context/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import { useSocialConnections } from "@/hooks/useSocialConnections";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type CreatorInfo = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

type CreatorInfoResponse = {
  ok: boolean;
  connected: boolean;
  environment?: "sandbox" | "production";
  account_name?: string | null;
  open_id?: string;
  creator?: CreatorInfo;
};

const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Public to everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends (mutual followers)",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me (private)",
};

async function extractInvokeError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error?.message) return body.error.message;
      if (typeof body?.error === "string") return body.error;
    } catch {
      /* keep fallback */
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export const TikTokDirectPostPanel = () => {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { connect, tiktok, tiktokStatus, refetch: refetchConnections } = useSocialConnections({
    onError: (msg) => toast.error(msg),
    onConnected: () => {
      toast.success("TikTok connected");
      refetchCreator();
    },
  });

  // Form state — strictly conforms to TikTok Content Sharing & Direct Post UX Guidelines:
  // - Privacy has NO pre-selected default
  // - Allow Comment / Duet / Stitch are ALL unchecked by default
  // - Commercial content disclosure is OFF by default
  const [postMode, setPostMode] = useState<"direct" | "draft">("direct");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [caption, setCaption] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState("");
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [discloseContent, setDiscloseContent] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [brandContent, setBrandContent] = useState(false);

  // Publishing & live status polling state
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{
    publishId: string;
    mode: "direct" | "draft";
    status: string;
    failReason?: string | null;
    postUrl?: string | null;
  } | null>(null);

  const companyId = selectedCompany?.id;

  const {
    data: creatorData,
    isLoading: creatorLoading,
    error: creatorError,
    refetch: refetchCreator,
  } = useQuery<CreatorInfoResponse & { fallbackMode?: boolean }>({
    queryKey: ["tiktok-creator-info", companyId, tiktok?.account_id],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("tiktok-web-publish", {
        body: { action: "creator_info", company_id: companyId },
      });
      if (!error && data) return data as CreatorInfoResponse;
      // Graceful fallback if tiktok-web-publish is not yet deployed on Lovable Cloud:
      // read safe connection metadata from social_credentials and publish via publish-meta-post.
      if (tiktok?.account_id) {
        return {
          ok: true,
          connected: true,
          fallbackMode: true,
          environment: tiktok.environment === "production" ? "production" : "sandbox",
          account_name: tiktok.account_name,
          open_id: tiktok.account_id,
          creator: {
            creator_nickname: tiktok.account_name || "TikTok Creator",
            privacy_level_options:
              tiktok.environment === "production"
                ? ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]
                : ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"],
            comment_disabled: false,
            duet_disabled: false,
            stitch_disabled: false,
            max_video_post_duration_sec: 600,
          },
        };
      }
      return { ok: true, connected: false, fallbackMode: true };
    },
    retry: false,
  });

  // Load company videos from media library
  const { data: libraryVideos = [] } = useQuery({
    queryKey: ["company-videos", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_media")
        .select("id, file_name, file_path, file_size, file_type, media_type, created_at")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data || [])
        .filter((m) => m.media_type === "video" || m.file_type?.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(m.file_name))
        .map((m) => ({
          ...m,
          publicUrl: supabase.storage.from("company-media").getPublicUrl(m.file_path).data.publicUrl,
        }));
    },
  });

  // Clear SELF_ONLY if Branded Content is toggled ON (TikTok UX requirement)
  useEffect(() => {
    if (discloseContent && brandContent && privacyLevel === "SELF_ONLY") {
      setPrivacyLevel("");
    }
  }, [discloseContent, brandContent, privacyLevel]);

  // Poll TikTok publish status every 3s while processing
  useEffect(() => {
    if (!publishResult || !companyId || creatorData?.fallbackMode) return;
    const terminal = ["PUBLISH_COMPLETE", "SEND_TO_USER_INBOX", "FAILED"];
    if (terminal.includes(publishResult.status)) return;

    const timer = window.setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("tiktok-web-publish", {
          body: {
            action: "status",
            company_id: companyId,
            publish_id: publishResult.publishId,
            creator_username: creatorData?.creator?.creator_username ?? null,
          },
        });
        if (!error && data?.ok) {
          setPublishResult((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status || prev.status,
                  failReason: data.fail_reason ?? prev.failReason,
                  postUrl: data.post_url ?? prev.postUrl,
                }
              : null,
          );
          if (terminal.includes(data.status)) {
            queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] });
          }
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [publishResult, companyId, creatorData?.creator?.creator_username, queryClient]);

  const handleVideoUpload = async (file: File) => {
    if (!companyId) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Please select an MP4, MOV, or WebM video file.");
      return;
    }
    if (file.size > 64 * 1024 * 1024) {
      toast.error("Video exceeds the 64 MB upload limit.");
      return;
    }
    setUploadingVideo(true);
    try {
      const ext = file.name.split(".").pop() || "mp4";
      const path = `${companyId}/promotional/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("company-media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from("company-media").getPublicUrl(path);
      setVideoUrl(pub.publicUrl);
      setVideoDurationSec(null);
      toast.success("Video uploaded and ready to preview.");
    } catch (e: any) {
      toast.error(e?.message || "Video upload failed.");
    } finally {
      setUploadingVideo(false);
    }
  };

  const creator = creatorData?.creator;
  const maxDurationSec = creator?.max_video_post_duration_sec ?? null;
  const durationTooLong = Boolean(maxDurationSec && videoDurationSec && videoDurationSec > maxDurationSec);
  const privacyOptions = (creator?.privacy_level_options && creator.privacy_level_options.length > 0)
    ? creator.privacy_level_options
    : ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];

  const disclosureIncomplete = postMode === "direct" && discloseContent && !brandOrganic && !brandContent;
  const privacyMissing = postMode === "direct" && !privacyLevel;
  const canPublish =
    Boolean(videoUrl) &&
    !durationTooLong &&
    !publishing &&
    !privacyMissing &&
    !disclosureIncomplete;

  const handlePublish = async () => {
    if (!companyId || !canPublish) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      if (creatorData?.fallbackMode && tiktok?.account_id) {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id;
        if (!uid) throw new Error("Sign in first.");
        const { data: postRow, error: insErr } = await supabase
          .from("scheduled_posts")
          .insert({
            company_id: companyId,
            page_id: tiktok.account_id,
            content: caption.trim() || "(TikTok draft video)",
            video_url: videoUrl,
            target_platform: "tiktok",
            scheduled_time: new Date().toISOString(),
            status: "draft",
            created_by: uid,
            metadata: {
              source: "web_tiktok_direct",
              mode: postMode,
              media_type: "video",
              privacy_level: postMode === "direct" ? privacyLevel : "SELF_ONLY",
              brand_organic_toggle: postMode === "direct" && discloseContent && brandOrganic,
              brand_content_toggle: postMode === "direct" && discloseContent && brandContent,
            },
          })
          .select("id")
          .single();
        if (insErr || !postRow) throw new Error(insErr?.message || "Could not create post record.");
        const { data: pubRes, error: pubErr } = await supabase.functions.invoke("publish-meta-post", {
          body: { post_id: postRow.id },
        });
        if (pubErr) throw new Error(await extractInvokeError(pubErr, "Could not publish to TikTok."));
        if (pubRes?.error) throw new Error(pubRes.error);
        const mappedStatus =
          pubRes?.status === "published"
            ? "PUBLISH_COMPLETE"
            : pubRes?.status === "sent_to_inbox"
              ? "SEND_TO_USER_INBOX"
              : "PROCESSING_UPLOAD";
        setPublishResult({
          publishId: pubRes?.meta_post_id || postRow.id,
          mode: postMode,
          status: mappedStatus,
          postUrl: pubRes?.post_url ?? null,
        });
        queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] });
        toast.success(
          postMode === "direct"
            ? "Uploaded to TikTok — publish status updated below."
            : "Video sent to TikTok Inbox!",
        );
        return;
      }

      const { data, error } = await supabase.functions.invoke("tiktok-web-publish", {
        body: {
          action: "publish",
          company_id: companyId,
          mode: postMode,
          video_url: videoUrl,
          caption: caption.trim(),
          privacy_level: postMode === "direct" ? privacyLevel : "SELF_ONLY",
          disable_comment: postMode === "direct" ? (!allowComment || Boolean(creator?.comment_disabled)) : false,
          disable_duet: postMode === "direct" ? (!allowDuet || Boolean(creator?.duet_disabled)) : false,
          disable_stitch: postMode === "direct" ? (!allowStitch || Boolean(creator?.stitch_disabled)) : false,
          brand_organic_toggle: postMode === "direct" && discloseContent && brandOrganic,
          brand_content_toggle: postMode === "direct" && discloseContent && brandContent,
        },
      });
      if (error) throw new Error(await extractInvokeError(error, "Could not publish to TikTok."));
      setPublishResult({
        publishId: data.publish_id,
        mode: postMode,
        status: data.tiktok_status || "PROCESSING_UPLOAD",
        failReason: data.fail_reason ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] });
      toast.success(
        postMode === "direct"
          ? "Uploaded to TikTok — tracking publish status below."
          : "Video sent to TikTok Inbox!",
      );
    } catch (e: any) {
      toast.error(e?.message || "TikTok publish failed.");
    } finally {
      setPublishing(false);
    }
  };

  if (!selectedCompany) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Music2 className="w-5 h-5" />
              Publish to TikTok
            </CardTitle>
            <CardDescription>
              Direct Post or send drafts to your connected TikTok creator account.
            </CardDescription>
          </div>
          {creatorData?.connected && (
            <Button variant="ghost" size="sm" onClick={() => refetchCreator()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh creator info
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {creatorLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading TikTok creator settings…</span>
          </div>
        ) : creatorError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-destructive text-sm font-medium">
              <AlertCircle className="w-4 h-4" />
              {(creatorError as Error).message}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => refetchCreator()}>Retry</Button>
              <Button size="sm" onClick={() => connect("tiktok")}>Reconnect TikTok</Button>
            </div>
          </div>
        ) : !creatorData?.connected ? (
          <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
            <Music2 className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">No TikTok account connected for {selectedCompany.name}</p>
            <p className="text-xs text-muted-foreground">
              Connect a TikTok account to publish videos directly or send drafts to your TikTok inbox.
            </p>
            <Button
              onClick={() => {
                connect("tiktok");
                refetchConnections();
              }}
              size="sm"
            >
              {tiktokStatus === "connected" ? "Reconnect TikTok" : "Connect TikTok"}
            </Button>
          </div>
        ) : (
          <>
            {/* 1. Connected Creator Info Banner (Required by TikTok UX Guidelines) */}
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-3 min-w-0">
                {creator?.creator_avatar_url ? (
                  <img
                    src={creator.creator_avatar_url}
                    alt={creator.creator_nickname || "TikTok avatar"}
                    className="w-10 h-10 rounded-full object-cover border"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <Music2 className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {creator?.creator_nickname || creatorData.account_name || "TikTok Creator"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {creator?.creator_username ? `@${creator.creator_username}` : creatorData.open_id}
                    {maxDurationSec ? ` · Max video ${Math.floor(maxDurationSec / 60)}m ${maxDurationSec % 60 ? `${maxDurationSec % 60}s` : ""}` : ""}
                  </p>
                </div>
              </div>
              <Badge variant={creatorData.environment === "production" ? "default" : "secondary"}>
                {creatorData.environment === "production" ? "Production" : "Sandbox"}
              </Badge>
            </div>

            {/* 2. Mode Toggle (Direct Post vs Inbox Draft) */}
            <div className="space-y-2">
              <Label>Publishing Mode</Label>
              <ToggleGroup
                type="single"
                value={postMode}
                onValueChange={(v) => {
                  if (v === "direct" || v === "draft") setPostMode(v);
                }}
                className="justify-start"
              >
                <ToggleGroupItem value="direct" className="gap-1.5 data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
                  <Send className="w-4 h-4" />
                  Direct Post
                </ToggleGroupItem>
                <ToggleGroupItem value="draft" className="gap-1.5 data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
                  <Video className="w-4 h-4" />
                  Send as Draft (TikTok Inbox)
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {postMode === "direct"
                  ? "Posts directly to your TikTok profile with the title, privacy, interaction, and disclosure settings below."
                  : "Uploads the video to your TikTok mobile app Inbox as a draft so you can finish editing and post inside TikTok."}
              </p>
            </div>

            {/* 3. Video Picker + Upload + Preview */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <Video className="w-4 h-4" />
                Video
              </Label>

              <div className="flex flex-wrap items-center gap-2">
                {libraryVideos.length > 0 && (
                  <Select
                    value={libraryVideos.some((v) => v.publicUrl === videoUrl) ? videoUrl : ""}
                    onValueChange={(u) => {
                      setVideoUrl(u);
                      setVideoDurationSec(null);
                    }}
                  >
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="Choose video from Media Library…" />
                    </SelectTrigger>
                    <SelectContent>
                      {libraryVideos.map((v) => (
                        <SelectItem key={v.id} value={v.publicUrl}>
                          {v.file_name} ({(v.file_size / 1048576).toFixed(1)} MB)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleVideoUpload(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingVideo}
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  {uploadingVideo ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Upload Video (MP4)</>
                  )}
                </Button>
              </div>

              {videoUrl && (
                <div className="rounded-lg border bg-black/90 p-2 space-y-1.5">
                  <video
                    src={videoUrl}
                    controls
                    className="max-h-72 mx-auto rounded"
                    onLoadedMetadata={(e) => {
                      const dur = Math.round(e.currentTarget.duration);
                      if (Number.isFinite(dur) && dur > 0) setVideoDurationSec(dur);
                    }}
                  />
                  {videoDurationSec !== null && (
                    <p className={`text-xs text-center ${durationTooLong ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      Duration: {videoDurationSec}s
                      {durationTooLong && maxDurationSec ? ` — exceeds creator limit of ${maxDurationSec}s` : ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 4. Caption / Title */}
            <div className="space-y-2">
              <Label htmlFor="tiktok-caption">
                Title / Caption {postMode === "draft" && <span className="font-normal text-muted-foreground">(added inside TikTok for draft uploads)</span>}
              </Label>
              <Textarea
                id="tiktok-caption"
                placeholder={postMode === "direct" ? "Write your TikTok caption and #hashtags…" : "Optional note (TikTok draft videos add caption in the app)"}
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">{caption.length} / 2200 characters</p>
            </div>

            {postMode === "direct" && (
              <>
                {/* 5. Privacy Level Dropdown — NO default pre-selected */}
                <div className="space-y-2">
                  <Label>Who can view this video *</Label>
                  <Select value={privacyLevel} onValueChange={setPrivacyLevel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select privacy level…" />
                    </SelectTrigger>
                    <SelectContent>
                      {privacyOptions.map((opt) => {
                        const blockedByBranded = opt === "SELF_ONLY" && discloseContent && brandContent;
                        return (
                          <SelectItem key={opt} value={opt} disabled={blockedByBranded}>
                            {PRIVACY_LABELS[opt] || opt}
                            {blockedByBranded ? " — unavailable for Branded Content" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {discloseContent && brandContent && (
                    <p className="text-xs text-muted-foreground">
                      Branded content visibility cannot be set to private (Only me).
                    </p>
                  )}
                </div>

                {/* 6. Interaction Settings — ALL unchecked by default */}
                <div className="space-y-2.5">
                  <Label>Allow users to</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border p-3">
                    <label className={`flex items-center gap-2 text-sm ${creator?.comment_disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                      <Checkbox
                        checked={allowComment && !creator?.comment_disabled}
                        disabled={Boolean(creator?.comment_disabled)}
                        onCheckedChange={(v) => setAllowComment(Boolean(v))}
                      />
                      <span>Comment</span>
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${creator?.duet_disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                      <Checkbox
                        checked={allowDuet && !creator?.duet_disabled}
                        disabled={Boolean(creator?.duet_disabled)}
                        onCheckedChange={(v) => setAllowDuet(Boolean(v))}
                      />
                      <span>Duet</span>
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${creator?.stitch_disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                      <Checkbox
                        checked={allowStitch && !creator?.stitch_disabled}
                        disabled={Boolean(creator?.stitch_disabled)}
                        onCheckedChange={(v) => setAllowStitch(Boolean(v))}
                      />
                      <span>Stitch</span>
                    </label>
                  </div>
                  {(creator?.comment_disabled || creator?.duet_disabled || creator?.stitch_disabled) && (
                    <p className="text-xs text-muted-foreground">
                      Disabled options reflect restrictions enabled on this TikTok creator account.
                    </p>
                  )}
                </div>

                {/* 7. Commercial Content Disclosure — OFF by default */}
                <div className="space-y-3 rounded-lg border p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="tiktok-disclose" className="cursor-pointer">Disclose video content</Label>
                      <p className="text-xs text-muted-foreground">
                        Turn on to disclose that this video promotes goods or services in exchange for something of value.
                      </p>
                    </div>
                    <Switch
                      id="tiktok-disclose"
                      checked={discloseContent}
                      onCheckedChange={(checked) => {
                        setDiscloseContent(checked);
                        if (!checked) {
                          setBrandOrganic(false);
                          setBrandContent(false);
                        }
                      }}
                    />
                  </div>

                  {discloseContent && (
                    <div className="space-y-2.5 pt-2 border-t">
                      <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                        <Checkbox
                          checked={brandOrganic}
                          onCheckedChange={(v) => setBrandOrganic(Boolean(v))}
                          className="mt-0.5"
                        />
                        <div>
                          <span className="font-medium">Your brand</span>
                          <p className="text-xs text-muted-foreground">
                            You are promoting yourself or your own business. Your video will be labeled as &ldquo;Promotional content&rdquo;.
                          </p>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                        <Checkbox
                          checked={brandContent}
                          onCheckedChange={(v) => setBrandContent(Boolean(v))}
                          className="mt-0.5"
                        />
                        <div>
                          <span className="font-medium">Branded content</span>
                          <p className="text-xs text-muted-foreground">
                            You are promoting another brand or a third party. Your video will be labeled as &ldquo;Paid partnership&rdquo;.
                          </p>
                        </div>
                      </label>

                      {disclosureIncomplete && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                          <Info className="w-3.5 h-3.5 flex-shrink-0" />
                          You need to indicate if your content promotes yourself, a third party, or both.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 8. Required TikTok Legal Declaration */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {postMode === "direct" && discloseContent && brandContent ? (
                <>
                  By posting, you agree to TikTok&apos;s{" "}
                  <a
                    href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Branded Content Policy
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Music Usage Confirmation
                  </a>
                  .
                </>
              ) : (
                <>
                  By posting, you agree to TikTok&apos;s{" "}
                  <a
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Music Usage Confirmation
                  </a>
                  .
                </>
              )}
            </p>

            {/* Publish CTA */}
            <Button
              type="button"
              onClick={handlePublish}
              disabled={!canPublish}
              className="w-full gap-2"
              title={
                disclosureIncomplete
                  ? "Select Your brand or Branded content to continue"
                  : privacyMissing
                    ? "Select a privacy level to continue"
                    : undefined
              }
            >
              {publishing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Uploading to TikTok…</>
              ) : (
                <><Send className="w-4 h-4" /> {postMode === "direct" ? "Publish to TikTok" : "Send Draft to TikTok Inbox"}</>
              )}
            </Button>

            {/* 9. Live Processing & Status Feedback */}
            {publishResult && (
              <div className="rounded-lg border p-3.5 space-y-1.5 bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {publishResult.status === "PUBLISH_COMPLETE" || publishResult.status === "SEND_TO_USER_INBOX" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : publishResult.status === "FAILED" ? (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    ) : (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    )}
                    <span>
                      {publishResult.status === "PUBLISH_COMPLETE"
                        ? "Published to TikTok!"
                        : publishResult.status === "SEND_TO_USER_INBOX"
                          ? "Sent to your TikTok Inbox!"
                          : publishResult.status === "FAILED"
                            ? "TikTok publishing failed"
                            : "Processing on TikTok…"}
                    </span>
                  </div>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {publishResult.status}
                  </Badge>
                </div>
                {publishResult.failReason && (
                  <p className="text-xs text-destructive">{publishResult.failReason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {publishResult.mode === "direct"
                    ? "It may take a few minutes for your video to appear on your TikTok profile."
                    : "Open the TikTok mobile app → Inbox → System notifications to finish and post your draft."}
                </p>
                {publishResult.postUrl && (
                  <a
                    href={publishResult.postUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary underline"
                  >
                    View on TikTok <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TikTokDirectPostPanel;
