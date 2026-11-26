import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/context/CompanyContext";
import { logAdminAction } from "@/lib/adminAudit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CalendarPlus,
  Check,
  Clapperboard,
  Coins,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Video,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface ShotItem {
  n: number;
  camera: string;
  lighting: string;
  action: string;
  seedance_prompt: string;
}

interface StoryboardPlan {
  style: string | null;
  hook: string | null;
  beats: string[];
  cta: string | null;
  voiceover: string | null;
  shots: ShotItem[];
  hero_shot: number;
}

interface MediaOption {
  id: string;
  file_name: string;
  url: string;
  media_type: string;
}

const STYLE_OPTIONS = [
  { value: "auto", label: "Auto (Director chooses)" },
  { value: "saas_launch", label: "SaaS Launch Video" },
  { value: "real_footage_motion", label: "Motion on Real Footage" },
  { value: "hypermotion_product", label: "Hypermotion Product Ad" },
  { value: "flythrough_3d", label: "3D Flythrough" },
  { value: "explainer_2d", label: "2D Explainer" },
  { value: "editorial_explainer", label: "Editorial Explainer" },
  { value: "cinematic", label: "Cinematic" },
];

export const VideoStudioPanel = () => {
  const { selectedCompany, refreshCompanies } = useCompany();
  const navigate = useNavigate();

  const [brief, setBrief] = useState("");
  const [styleHint, setStyleHint] = useState("auto");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [duration, setDuration] = useState<"5" | "10">("5");
  const [useScriptOverride, setUseScriptOverride] = useState(false);
  const [scriptOverride, setScriptOverride] = useState("");

  const [mediaOptions, setMediaOptions] = useState<MediaOption[]>([]);
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);

  const [plan, setPlan] = useState<StoryboardPlan | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [submittingRender, setSubmittingRender] = useState(false);

type VideoJob = Database["public"]["Tables"]["video_generation_jobs"]["Row"];

interface CompanyMediaRow {
  id: string;
  file_name: string | null;
  file_path: string | null;
  thumbnail_url: string | null;
  media_type: string | null;
  asset_validation_status: string | null;
}

  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [pollingNow, setPollingNow] = useState(false);
  const [schedulingJobId, setSchedulingJobId] = useState<string | null>(null);

  const estimatedCost = useMemo(() => {
    const seconds = Math.max(1, Number(duration) || 5);
    const perSecond = resolution === "1080p" ? 0.124 : resolution === "480p" ? 0.024 : 0.056;
    return Math.max(1, Math.ceil(seconds * perSecond * 10));
  }, [duration, resolution]);

  const loadJobsAndMedia = async (silent = false) => {
    if (!selectedCompany?.id) return;
    if (!silent) setLoadingJobs(true);
    try {
      const [jobsRes, mediaRes] = await Promise.all([
        supabase
          .from("video_generation_jobs")
          .select("*")
          .eq("company_id", selectedCompany.id)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("company_media")
          .select("id, file_name, file_path, thumbnail_url, media_type, asset_validation_status")
          .eq("company_id", selectedCompany.id)
          .order("created_at", { ascending: false })
          .limit(24),
      ]);

      setJobs(jobsRes.data || []);

      const imgs: MediaOption[] = ((mediaRes.data || []) as CompanyMediaRow[])
        .filter((m) => String(m.media_type || "").startsWith("image") || /\.(png|jpe?g|webp)$/i.test(m.file_name || ""))
        .map((m) => {
          const publicUrl = m.file_path
            ? supabase.storage.from("company-media").getPublicUrl(m.file_path).data.publicUrl
            : m.thumbnail_url || "";
          return {
            id: m.id,
            file_name: m.file_name || "asset",
            url: publicUrl,
            media_type: m.media_type || "image/jpeg",
          };
        })
        .filter((m) => Boolean(m.url));
      setMediaOptions(imgs);
    } finally {
      if (!silent) setLoadingJobs(false);
    }
  };

  useEffect(() => {
    setPlan(null);
    setSelectedImageUrls([]);
    loadJobsAndMedia(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  // Auto-poll every 15s while any job is pending
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === "pending");
    if (!hasPending || !selectedCompany?.id) return;
    const t = setInterval(() => {
      loadJobsAndMedia(true);
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, selectedCompany?.id]);

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a company to open Video Studio
      </div>
    );
  }

  const creditBalance = Number(selectedCompany.credit_balance ?? 0);
  const insufficientCredits = creditBalance < estimatedCost;

  const toggleReferenceImage = (url: string) => {
    setSelectedImageUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : prev.length < 4 ? [...prev, url] : prev
    );
  };

  const buildBriefPayload = () => {
    if (styleHint === "auto") return brief.trim();
    return `[Preferred style: ${styleHint}] ${brief.trim()}`;
  };

  const handleGeneratePlan = async () => {
    if (!brief.trim()) {
      toast.error("Describe the video ad brief first");
      return;
    }
    setGeneratingPlan(true);
    try {
      const { data, error } = await supabase.functions.invoke("omanut-motion", {
        body: {
          company_id: selectedCompany.id,
          brief: buildBriefPayload(),
          aspect_ratio: aspectRatio,
          resolution,
          duration,
          image_urls: selectedImageUrls.length ? selectedImageUrls : null,
          plan_only: true,
        },
      });
      if (error || data?.error) {
        throw new Error(data?.error || error?.message || "Failed to generate storyboard");
      }
      setPlan({
        style: data.style || null,
        hook: data.hook || null,
        beats: Array.isArray(data.beats) ? data.beats : [],
        cta: data.cta || null,
        voiceover: data.voiceover || null,
        shots: Array.isArray(data.shots) ? data.shots : [],
        hero_shot: Number(data.hero_shot || 1),
      });
      toast.success("Storyboard generated (0 credits charged)");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not generate storyboard");
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleRender = async () => {
    if (useScriptOverride && !scriptOverride.trim()) {
      toast.error("Enter a script override first");
      return;
    }
    if (!useScriptOverride && !brief.trim() && !plan) {
      toast.error("Enter a brief or generate a storyboard first");
      return;
    }
    if (insufficientCredits) {
      toast.error(`Requires ${estimatedCost} credits (balance: ${creditBalance})`);
      return;
    }

    setSubmittingRender(true);
    try {
      const payload: Record<string, unknown> = {
        company_id: selectedCompany.id,
        brief: buildBriefPayload() || scriptOverride.slice(0, 140),
        aspect_ratio: aspectRatio,
        resolution,
        duration,
        image_urls: selectedImageUrls.length ? selectedImageUrls : null,
      };

      if (useScriptOverride) {
        payload.script_override = scriptOverride.trim();
      } else if (plan) {
        payload.approved_plan = {
          script: {
            style: plan.style,
            hook: plan.hook,
            beats: plan.beats,
            cta: plan.cta,
            voiceover: plan.voiceover,
          },
          shots: plan.shots,
          hero_shot: plan.hero_shot,
        };
      }

      const { data, error } = await supabase.functions.invoke("omanut-motion", {
        body: payload,
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || "Render submission failed");
      }

      await logAdminAction({
        eventType: "admin_video_render_started",
        companyId: selectedCompany.id,
        message: `Submitted Omanut Motion render (${resolution}, ${duration}s, ${aspectRatio}, -${data?.credits_charged ?? estimatedCost} credits)`,
        details: {
          job_id: data?.job_id,
          style: data?.style,
          resolution,
          duration,
          credits_charged: data?.credits_charged,
        },
      });

      toast.success(
        `Render queued (${data?.credits_charged ?? estimatedCost} credits charged). Polling in background…`
      );
      await refreshCompanies();
      await loadJobsAndMedia(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start render");
    } finally {
      setSubmittingRender(false);
    }
  };

  const handlePollNow = async () => {
    setPollingNow(true);
    try {
      const { error } = await supabase.functions.invoke("poll-video-generation", { body: {} });
      if (error) throw error;
      await loadJobsAndMedia(true);
      toast.success("Polled video jobs");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to poll video status");
    } finally {
      setPollingNow(false);
    }
  };

  const handleSendToScheduler = async (job: VideoJob) => {
    if (!job.video_url) return;
    setSchedulingJobId(job.id);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data: metaCred } = await supabase
        .from("meta_credentials")
        .select("page_id")
        .eq("company_id", selectedCompany.id)
        .limit(1)
        .maybeSingle();

      const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const postData = (job.scheduled_post_data as { marketing_plan?: { hook?: string }; brief?: string } | null) || {};
      const caption =
        postData?.marketing_plan?.hook ||
        postData?.brief ||
        job.prompt ||
        `${selectedCompany.name} video highlight`;

      const { error } = await supabase.from("scheduled_posts").insert({
        company_id: selectedCompany.id,
        page_id: metaCred?.page_id || "unassigned",
        content: String(caption),
        scheduled_time: scheduledTime,
        status: "pending_approval",
        created_by: auth.user?.id,
        video_url: job.video_url,
        target_platform: "facebook",
        metadata: { source: "omanut_motion", video_job_id: job.id },
      });

      if (error) throw error;

      toast.success("Added to Content Scheduler (pending approval)", {
        action: {
          label: "Open Scheduler",
          onClick: () => navigate(`/admin/dashboard?company=${selectedCompany.id}&tab=content-scheduler`),
        },
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add to Content Scheduler");
    } finally {
      setSchedulingJobId(null);
    }
  };

  const updateShotPrompt = (n: number, nextPrompt: string) => {
    if (!plan) return;
    setPlan({
      ...plan,
      shots: plan.shots.map((s) => (s.n === n ? { ...s, seedance_prompt: nextPrompt } : s)),
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Clapperboard className="h-6 w-6 text-primary" />
            Omanut Motion Video Studio
          </h2>
          <p className="text-sm text-muted-foreground">
            Multi-agent storyboard director + ByteDance Seedance 2.5 (fal.ai) for {selectedCompany.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={insufficientCredits ? "destructive" : "secondary"} className="gap-1.5 px-3 py-1">
            <Coins className="h-3.5 w-3.5" />
            Est. {estimatedCost} credits (Bal: {creditBalance})
          </Badge>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left: Brief & Storyboard Director */}
        <div className="lg:col-span-7 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                1. Video Brief & Settings
              </CardTitle>
              <CardDescription>
                Generate a free storyboard plan first, or pass a verbatim script override.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border">
                <div>
                  <p className="text-xs font-medium">Direct Script Override</p>
                  <p className="text-[11px] text-muted-foreground">
                    Skip Marketing/Director stages and send your exact Seedance prompt verbatim
                  </p>
                </div>
                <Switch checked={useScriptOverride} onCheckedChange={setUseScriptOverride} />
              </div>

              {useScriptOverride ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Full Seedance Prompt / Script</Label>
                  <Textarea
                    rows={4}
                    value={scriptOverride}
                    onChange={(e) => setScriptOverride(e.target.value)}
                    placeholder="Exact visual scene, camera move, lighting, dialogue..."
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">Campaign Brief</Label>
                  <Textarea
                    rows={3}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="e.g., 15-second launch ad showing a Lusaka shop owner tracking stock on OmanutBMS in warm morning light"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Style</Label>
                  <Select value={styleHint} onValueChange={setStyleHint} disabled={useScriptOverride}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Aspect</Label>
                  <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as "9:16" | "16:9" | "1:1")}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9:16">9:16 (Reels/TikTok)</SelectItem>
                      <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                      <SelectItem value="1:1">1:1 (Square)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Resolution</Label>
                  <Select value={resolution} onValueChange={(v) => setResolution(v as "480p" | "720p" | "1080p")}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="480p">480p (Draft)</SelectItem>
                      <SelectItem value="720p">720p (Standard)</SelectItem>
                      <SelectItem value="1080p">1080p (HD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Duration</Label>
                  <Select value={duration} onValueChange={(v) => setDuration(v as "5" | "10")}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 seconds</SelectItem>
                      <SelectItem value="10">10 seconds</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Reference Images Picker (Seedance 2.5) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    Product / Brand Reference Images (Seedance 2.5, max 4)
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedImageUrls.length} selected
                  </span>
                </div>
                {mediaOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No images in Media Library yet — upload packshots in Media Library to lock product identity.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-36 overflow-y-auto p-1">
                    {mediaOptions.map((img) => {
                      const selected = selectedImageUrls.includes(img.url);
                      return (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => toggleReferenceImage(img.url)}
                          className={`relative rounded-md overflow-hidden border-2 h-16 transition-all ${
                            selected ? "border-primary ring-2 ring-primary/30" : "border-border opacity-80 hover:opacity-100"
                          }`}
                          title={img.file_name}
                        >
                          <img src={img.url} alt={img.file_name} className="w-full h-full object-cover" />
                          {selected && (
                            <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {!useScriptOverride && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGeneratePlan}
                    disabled={generatingPlan || submittingRender || !brief.trim()}
                    className="gap-1.5"
                  >
                    {generatingPlan ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-primary" />
                    )}
                    Generate Storyboard (Free)
                  </Button>
                )}

                <Button
                  type="button"
                  onClick={handleRender}
                  disabled={submittingRender || generatingPlan || insufficientCredits}
                  className="gap-1.5 ml-auto"
                >
                  {submittingRender ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Film className="h-4 w-4" />
                  )}
                  {plan && !useScriptOverride
                    ? `Approve & Render Hero Shot (-${estimatedCost} cr)`
                    : `Render Video (-${estimatedCost} cr)`}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Storyboard Preview */}
          {plan && !useScriptOverride && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">2. Approved Storyboard Preview</CardTitle>
                  {plan.style && <Badge variant="secondary">{plan.style}</Badge>}
                </div>
                {plan.hook && (
                  <CardDescription>
                    <strong>2s Hook:</strong> {plan.hook}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {plan.voiceover && (
                  <div className="p-2.5 rounded bg-muted">
                    <span className="font-semibold">Voiceover: </span>
                    {plan.voiceover}
                  </div>
                )}
                {plan.cta && (
                  <div className="text-muted-foreground">
                    <strong>CTA:</strong> {plan.cta}
                  </div>
                )}

                <div className="space-y-2.5">
                  {plan.shots.map((shot) => {
                    const isHero = plan.hero_shot === shot.n;
                    return (
                      <div
                        key={shot.n}
                        className={`p-3 rounded-lg border space-y-2 ${
                          isHero ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={isHero ? "default" : "outline"}>Shot {shot.n}</Badge>
                            {shot.camera && <span className="text-muted-foreground">{shot.camera}</span>}
                            {shot.lighting && <span className="text-muted-foreground">· {shot.lighting}</span>}
                          </div>
                          <Button
                            size="sm"
                            variant={isHero ? "secondary" : "ghost"}
                            className="h-6 text-[11px]"
                            onClick={() => setPlan({ ...plan, hero_shot: shot.n })}
                          >
                            {isHero ? "Hero Shot" : "Set as Hero"}
                          </Button>
                        </div>
                        <p>{shot.action}</p>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Seedance Prompt</Label>
                          <Input
                            value={shot.seedance_prompt}
                            onChange={(e) => updateShotPrompt(shot.n, e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Render Queue */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Video className="h-4 w-4 text-primary" />
                  Render Queue ({jobs.length})
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  onClick={handlePollNow}
                  disabled={pollingNow}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${pollingNow ? "animate-spin" : ""}`} />
                  Poll Now
                </Button>
              </div>
              <CardDescription>
                Pending jobs auto-refresh every 15s and deliver via WhatsApp when done
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0">
              <ScrollArea className="h-[580px] pr-2">
                {loadingJobs ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Loading renders…
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    No video renders yet for {selectedCompany.name}.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job) => (
                      <div key={job.id} className="p-3 rounded-lg border border-border space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={
                                job.status === "completed"
                                  ? "default"
                                  : job.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {job.status}
                              {job.status === "pending" && job.poll_count != null
                                ? ` (${job.poll_count}/60)`
                                : ""}
                            </Badge>
                            <Badge variant="outline">{job.video_provider}</Badge>
                            {job.aspect_ratio && <Badge variant="outline">{job.aspect_ratio}</Badge>}
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {job.created_at
                              ? formatDistanceToNow(new Date(job.created_at), { addSuffix: true })
                              : ""}
                          </span>
                        </div>

                        {job.prompt && (
                          <p className="text-muted-foreground line-clamp-2">{job.prompt}</p>
                        )}

                        {job.error_message && (
                          <div className="text-destructive bg-destructive/10 rounded p-2 font-mono text-[11px]">
                            {job.error_message}
                          </div>
                        )}

                        {job.video_url && (
                          <div className="space-y-2 pt-1">
                            <video
                              src={job.video_url}
                              controls
                              playsInline
                              className="w-full rounded-md max-h-56 bg-black"
                            />
                            <div className="flex items-center gap-2">
                              <a
                                href={job.video_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border hover:bg-muted text-xs"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download MP4
                              </a>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 text-xs gap-1 ml-auto"
                                disabled={schedulingJobId === job.id}
                                onClick={() => handleSendToScheduler(job)}
                              >
                                <CalendarPlus className="h-3.5 w-3.5" />
                                {schedulingJobId === job.id ? "Adding…" : "Send to Scheduler"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
