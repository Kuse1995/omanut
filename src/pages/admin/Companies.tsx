import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ClaimCodesPanel } from "@/components/admin/ClaimCodesPanel";
import CompanyForm from "@/components/CompanyForm";
import { CompanyDocuments } from "@/components/CompanyDocuments";
import { useCompany } from "@/context/CompanyContext";
import { logAdminAction } from "@/lib/adminAudit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  KeyRound,
  MessageSquare,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];

interface BmsHealthRow {
  company_id: string;
  status: string;
  latency_ms: number | null;
  checked_at: string;
  error_message: string | null;
}

interface ClaimCodeRow {
  company_id: string;
  code: string;
  claimed_at: string | null;
}

interface FleetRow {
  company: CompanyRow;
  member_count: number;
  harness_mode: string;
  ai_replies_today: number;
  bms_status: string;
  bms_latency_ms: number | null;
  bms_checked_at: string | null;
  bms_error: string | null;
  platforms: {
    whatsapp: boolean;
    facebook: boolean;
    instagram: boolean;
    linkedin: boolean;
    tiktok: boolean;
  };
  token_issue: boolean;
  open_errors: number;
  open_violations: number;
  pending_media: number;
  pending_videos: number;
  claim: { code: string; claimed_at: string | null } | null;
  attention_reasons: string[];
}

interface FleetTotals {
  total_companies: number;
  production_companies: number;
  ai_replies_today: number;
  needs_attention: number;
  degraded_bms: number;
  expiring_tokens: number;
  pending_media: number;
}

type FleetFilter = "all" | "attention" | "production" | "test" | "degraded_bms" | "low_credits";

function getLusakaTodayStartIso(): string {
  const offsetMs = 2 * 60 * 60 * 1000;
  const localMs = Date.now() + offsetMs;
  const midnightLocalMs = Math.floor(localMs / 86_400_000) * 86_400_000;
  return new Date(midnightLocalMs - offsetMs).toISOString();
}

export default function Companies() {
  const navigate = useNavigate();
  const { switchCompany, refreshCompanies } = useCompany();

  const [rows, setRows] = useState<FleetRow[]>([]);
  const [totals, setTotals] = useState<FleetTotals>({
    total_companies: 0,
    production_companies: 0,
    ai_replies_today: 0,
    needs_attention: 0,
    degraded_bms: 0,
    expiring_tokens: 0,
    pending_media: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FleetFilter>("all");
  const [claimCodesOpen, setClaimCodesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  const loadFleetFallback = async () => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const todayStart = getLusakaTodayStartIso();

    const [
      compRes,
      membersRes,
      todayConvsRes,
      todayMsgsRes,
      bmsConnRes,
      bmsHealthRes,
      metaRes,
      socialRes,
      waCloudRes,
      errRes,
      violRes,
      mediaRes,
      claimRes,
    ] = await Promise.all([
      supabase.from("companies").select("*").order("created_at", { ascending: false }),
      supabase.from("company_users").select("company_id"),
      supabase.from("conversations").select("id, company_id").gte("last_message_at", todayStart).limit(2000),
      supabase.from("messages").select("conversation_id").eq("role", "assistant").gte("created_at", todayStart).limit(2000),
      supabase.from("bms_connections").select("company_id, is_active"),
      supabase.from("bms_health_log").select("company_id, status, latency_ms, checked_at, error_message").gte("checked_at", since24h).order("checked_at", { ascending: false }).limit(300),
      supabase.from("meta_credentials").select("company_id, page_id, ig_user_id, health_status"),
      supabase.from("social_credentials").select("company_id, platform, token_expires_at"),
      supabase.from("company_whatsapp_cloud").select("company_id, health_status"),
      supabase.from("ai_error_logs").select("company_id").eq("status", "open").limit(1000),
      supabase.from("rule_violations").select("company_id").eq("reviewed", false).limit(1000),
      supabase.from("company_media").select("company_id").eq("asset_validation_status", "pending").limit(1000),
      supabase.rpc("admin_list_claim_codes"),
    ]);

    if (compRes.error) throw compRes.error;
    const companies = compRes.data || [];

    const convCompany = new Map<string, string>();
    for (const c of todayConvsRes.data || []) if (c.company_id) convCompany.set(c.id, c.company_id);

    const repliesMap = new Map<string, number>();
    for (const m of todayMsgsRes.data || []) {
      const cid = convCompany.get(m.conversation_id);
      if (cid) repliesMap.set(cid, (repliesMap.get(cid) || 0) + 1);
    }

    const memberMap = new Map<string, number>();
    for (const mu of membersRes.data || []) memberMap.set(mu.company_id, (memberMap.get(mu.company_id) || 0) + 1);

    const bmsConnMap = new Map<string, boolean>();
    for (const bc of bmsConnRes.data || []) bmsConnMap.set(bc.company_id, bc.is_active);

    const bmsHealthMap = new Map<string, BmsHealthRow>();
    for (const bh of bmsHealthRes.data || []) if (!bmsHealthMap.has(bh.company_id)) bmsHealthMap.set(bh.company_id, bh);

    const errMap = new Map<string, number>();
    for (const e of errRes.data || []) errMap.set(e.company_id, (errMap.get(e.company_id) || 0) + 1);

    const violMap = new Map<string, number>();
    for (const v of violRes.data || []) violMap.set(v.company_id, (violMap.get(v.company_id) || 0) + 1);

    const mediaMap = new Map<string, number>();
    for (const pm of mediaRes.data || []) mediaMap.set(pm.company_id, (mediaMap.get(pm.company_id) || 0) + 1);

    const claimMap = new Map<string, { code: string; claimed_at: string | null }>();
    for (const cl of (claimRes.data as ClaimCodeRow[] | null) || []) claimMap.set(cl.company_id, { code: cl.code, claimed_at: cl.claimed_at });

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    let aiRepliesTotal = 0;
    let prodCount = 0;
    let attentionCount = 0;
    let degradedBms = 0;
    let expiring = 0;
    let pendingMediaTotal = 0;

    const built: FleetRow[] = companies.map((company) => {
      const md = (company.metadata as Record<string, unknown> | null) || {};
      const metas = (metaRes.data || []).filter((m) => m.company_id === company.id);
      const socials = (socialRes.data || []).filter((s) => s.company_id === company.id);
      const waCloud = (waCloudRes.data || []).find((w) => w.company_id === company.id);

      const hasBms = bmsConnMap.has(company.id);
      const bmsActive = bmsConnMap.get(company.id);
      const bh = bmsHealthMap.get(company.id);
      const bmsStatus = !hasBms ? "none" : !bmsActive ? "inactive" : bh?.status || "unknown";

      const openErrors = errMap.get(company.id) || 0;
      const openViolations = violMap.get(company.id) || 0;
      const pendingMedia = mediaMap.get(company.id) || 0;
      const repliesToday = repliesMap.get(company.id) || 0;

      const tokenIssue =
        socials.some((s) => s.token_expires_at && new Date(s.token_expires_at).getTime() - nowMs < sevenDaysMs) ||
        metas.some((m) => m.health_status && m.health_status !== "healthy") ||
        Boolean(waCloud && waCloud.health_status && waCloud.health_status !== "healthy");

      const isDegradedBms = bmsStatus === "degraded" || bmsStatus === "down";
      const lowCredits = Number(company.credit_balance ?? 0) < 50;
      const attentionReasons: string[] = [];
      if (openErrors > 0) attentionReasons.push(`${openErrors} AI error(s)`);
      if (openViolations > 0) attentionReasons.push(`${openViolations} rule violation(s)`);
      if (isDegradedBms) attentionReasons.push(`BMS ${bmsStatus}`);
      if (tokenIssue) attentionReasons.push("Token expiring/unhealthy");
      if (lowCredits) attentionReasons.push("Low credits");

      aiRepliesTotal += repliesToday;
      if (!company.test_mode) prodCount += 1;
      if (attentionReasons.length > 0) attentionCount += 1;
      if (isDegradedBms) degradedBms += 1;
      if (tokenIssue) expiring += 1;
      pendingMediaTotal += pendingMedia;

      return {
        company,
        member_count: memberMap.get(company.id) || 0,
        harness_mode: String(md.harness_mode || "off"),
        ai_replies_today: repliesToday,
        bms_status: bmsStatus,
        bms_latency_ms: bh?.latency_ms ?? null,
        bms_checked_at: bh?.checked_at ?? null,
        bms_error: bh?.error_message ?? null,
        platforms: {
          whatsapp: Boolean(company.whatsapp_number || waCloud),
          facebook: metas.some((m) => Boolean(m.page_id)),
          instagram: metas.some((m) => Boolean(m.ig_user_id)),
          linkedin: socials.some((s) => String(s.platform).includes("linkedin")),
          tiktok: socials.some((s) => String(s.platform).includes("tiktok")),
        },
        token_issue: tokenIssue,
        open_errors: openErrors,
        open_violations: openViolations,
        pending_media: pendingMedia,
        pending_videos: 0,
        claim: claimMap.get(company.id) || null,
        attention_reasons: attentionReasons,
      };
    });

    setRows(built);
    setTotals({
      total_companies: companies.length,
      production_companies: prodCount,
      ai_replies_today: aiRepliesTotal,
      needs_attention: attentionCount,
      degraded_bms: degradedBms,
      expiring_tokens: expiring,
      pending_media: pendingMediaTotal,
    });
  };

  const loadFleet = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-ops", {
        body: { action: "fleet_summary" },
      });
      if (!error && data?.companies) {
        setRows(data.companies);
        setTotals(data.totals);
        setUsedFallback(false);
      } else {
        setUsedFallback(true);
        await loadFleetFallback();
      }
    } catch {
      try {
        setUsedFallback(true);
        await loadFleetFallback();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to load fleet");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFleet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openWorkspace = async (companyId: string, tab = "conversations", extraQuery = "") => {
    await switchCompany(companyId);
    navigate(`/admin/dashboard?company=${companyId}&tab=${tab}${extraQuery}`);
  };

  const handleOpenSetup = async (companyId: string) => {
    await switchCompany(companyId);
    navigate("/setup");
  };

  const handleViewAsOwner = async (companyId: string) => {
    await switchCompany(companyId);
    navigate("/dashboard");
  };

  const handleToggleWhatsAppVoice = async (companyId: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from("companies")
        .update({ whatsapp_voice_enabled: !currentValue })
        .eq("id", companyId);
      if (error) throw error;

      await logAdminAction({
        eventType: "admin_wa_voice_toggled",
        companyId,
        message: `${!currentValue ? "Enabled" : "Disabled"} WhatsApp Voice AI`,
      });
      toast.success(`WhatsApp voice ${!currentValue ? "enabled" : "disabled"}`);
      loadFleet();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle WhatsApp voice");
    }
  };

  const handleDeleteCompany = async (companyId: string, companyName: string) => {
    try {
      const { error } = await supabase.rpc("delete_company", { p_company_id: companyId });
      if (error) throw error;
      await logAdminAction({
        eventType: "admin_company_deleted",
        companyId: null,
        severity: "critical",
        message: `Deleted company "${companyName}" (${companyId})`,
        details: { deleted_company_id: companyId, deleted_company_name: companyName },
      });
      toast.success(`${companyName} deleted successfully`);
      await refreshCompanies();
      loadFleet();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to delete company");
    }
  };

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        r.company.name?.toLowerCase().includes(q) ||
        r.company.business_type?.toLowerCase().includes(q) ||
        r.company.whatsapp_number?.toLowerCase().includes(q) ||
        r.company.twilio_number?.toLowerCase().includes(q);

      const matchesFilter =
        filter === "all"
          ? true
          : filter === "attention"
          ? r.attention_reasons.length > 0
          : filter === "production"
          ? !r.company.test_mode
          : filter === "test"
          ? !!r.company.test_mode
          : filter === "degraded_bms"
          ? r.bms_status === "degraded" || r.bms_status === "down"
          : filter === "low_credits"
          ? Number(r.company.credit_balance ?? 0) < 50
          : true;

      return matchesSearch && matchesFilter;
    });
  }, [rows, search, filter]);

  const bmsBadge = (row: FleetRow) => {
    if (row.bms_status === "none") return <span className="text-xs text-muted-foreground">—</span>;
    if (row.bms_status === "healthy") {
      return (
        <Badge
          variant="outline"
          className="text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
          title={row.bms_latency_ms ? `${row.bms_latency_ms}ms` : "Healthy"}
        >
          Healthy{row.bms_latency_ms ? ` · ${row.bms_latency_ms}ms` : ""}
        </Badge>
      );
    }
    if (row.bms_status === "degraded" || row.bms_status === "down") {
      return (
        <Badge variant="destructive" className="text-[10px]" title={row.bms_error || row.bms_status}>
          {row.bms_status}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-[10px]">
        {row.bms_status}
      </Badge>
    );
  };

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fleet Command</h1>
            <p className="text-sm text-muted-foreground">
              Multi-tenant health matrix · {totals.total_companies} companies ({totals.production_companies} live in production)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadFleet} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => navigate("/admin/companies/new")}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create Company
            </Button>
          </div>
        </div>

        {usedFallback && (
          <div className="text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-600 dark:text-amber-400">
            Showing direct client queries (deploy <code>admin-ops</code> edge function in Lovable for full server-side fleet aggregation).
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
              AI Replies Today (North Star)
            </div>
            <div className="text-2xl font-bold mt-1">{totals.ai_replies_today}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Africa/Lusaka day</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Production Tenants
            </div>
            <div className="text-2xl font-bold mt-1">
              {totals.production_companies}{" "}
              <span className="text-sm font-normal text-muted-foreground">/ {totals.total_companies}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Live outbound enabled</div>
          </Card>

          <Card
            className="p-4 cursor-pointer hover:border-amber-500/40 transition-colors"
            onClick={() => setFilter(filter === "attention" ? "all" : "attention")}
          >
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Needs Attention
            </div>
            <div className="text-2xl font-bold mt-1">{totals.needs_attention}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {totals.degraded_bms} BMS issues · {totals.expiring_tokens} token alerts
            </div>
          </Card>

          <Card
            className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => navigate("/admin/media-approvals")}
          >
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-blue-500" />
              Pending Media Approvals
            </div>
            <div className="text-2xl font-bold mt-1">{totals.pending_media}</div>
            <div className="text-[11px] text-primary mt-0.5">Review queue →</div>
          </Card>
        </div>

        {/* Search & Filter Pills */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search company, business type, or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { id: "all", label: `All (${rows.length})` },
                { id: "attention", label: `Needs Attention (${totals.needs_attention})` },
                { id: "production", label: "Production" },
                { id: "test", label: "Test Mode" },
                { id: "degraded_bms", label: "Degraded BMS" },
                { id: "low_credits", label: "Low Credits" },
              ] as const
            ).map((pill) => (
              <Button
                key={pill.id}
                size="sm"
                variant={filter === pill.id ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setFilter(pill.id)}
              >
                {pill.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Fleet Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Mode & Harness</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>BMS</TableHead>
                  <TableHead>Replies Today</TableHead>
                  <TableHead>Alerts</TableHead>
                  <TableHead>Voice AI</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      Loading fleet metrics…
                    </TableCell>
                  </TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      No companies match your search or filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const { company } = row;
                    return (
                      <TableRow key={company.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => openWorkspace(company.id)}
                            className="text-left group"
                          >
                            <div className="font-medium group-hover:text-primary transition-colors">
                              {company.name}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              <span className="capitalize">{company.business_type || "Business"}</span>
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {row.member_count}
                              </span>
                              {row.claim && !row.claim.claimed_at && (
                                <span className="text-amber-500 font-mono text-[10px]">unclaimed</span>
                              )}
                            </div>
                          </button>
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            <Badge variant={company.test_mode ? "secondary" : "default"} className="text-[10px]">
                              {company.test_mode ? "Test Mode" : "Production"}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              harness: {row.harness_mode}
                            </Badge>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {(
                              [
                                ["WA", row.platforms.whatsapp, "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"],
                                ["FB", row.platforms.facebook, "bg-blue-500/15 text-blue-500 border-blue-500/30"],
                                ["IG", row.platforms.instagram, "bg-pink-500/15 text-pink-500 border-pink-500/30"],
                                ["LI", row.platforms.linkedin, "bg-sky-500/15 text-sky-500 border-sky-500/30"],
                                ["TT", row.platforms.tiktok, "bg-purple-500/15 text-purple-500 border-purple-500/30"],
                              ] as const
                            ).map(([label, connected, cls]) => (
                              <span
                                key={label}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                  connected ? cls : "bg-muted/40 text-muted-foreground/40 border-border"
                                }`}
                              >
                                {label}
                              </span>
                            ))}
                            {row.token_issue && (
                              <Badge variant="destructive" className="text-[10px]" title="Token expiring or unhealthy">
                                !
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>{bmsBadge(row)}</TableCell>

                        <TableCell>
                          <span className="font-semibold text-sm">{row.ai_replies_today}</span>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {row.open_errors > 0 && (
                              <button
                                type="button"
                                onClick={() => openWorkspace(company.id, "ai-control", "&subtab=errors")}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25"
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {row.open_errors} err
                              </button>
                            )}
                            {row.open_violations > 0 && (
                              <button
                                type="button"
                                onClick={() => openWorkspace(company.id, "rule-violations")}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-500 border border-amber-500/30 hover:bg-amber-500/25"
                              >
                                <ShieldAlert className="h-2.5 w-2.5" />
                                {row.open_violations} rule
                              </button>
                            )}
                            {row.open_errors === 0 && row.open_violations === 0 && (
                              <span className="text-xs text-muted-foreground">Clean</span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <Switch
                            checked={company.whatsapp_voice_enabled || false}
                            onCheckedChange={() =>
                              handleToggleWhatsAppVoice(company.id, company.whatsapp_voice_enabled)
                            }
                            disabled={!company.whatsapp_number}
                          />
                        </TableCell>

                        <TableCell>
                          <Badge variant={(company.credit_balance ?? 0) >= 50 ? "default" : "destructive"}>
                            {company.credit_balance ?? 0}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openWorkspace(company.id)}
                              title="Open Admin Workspace"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenSetup(company.id)}
                              title="Setup & Connections"
                            >
                              <Plug className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleViewAsOwner(company.id)}
                              title="View as Owner (/dashboard)"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedCompanyId(company.id);
                                setSettingsOpen(true);
                              }}
                              title="Quick Edit Form"
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete {company.name}?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This permanently deletes {company.name} and all conversations, reservations, documents, and credit history. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteCompany(company.id, company.name)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete Company
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Collapsible Claim Codes */}
        <Collapsible open={claimCodesOpen} onOpenChange={setClaimCodesOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Company Claim Codes
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    claimCodesOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4">
              <ClaimCodesPanel />
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Company Settings</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {selectedCompanyId && (
              <>
                <CompanyForm
                  companyId={selectedCompanyId}
                  onSuccess={() => {
                    setSettingsOpen(false);
                    setSelectedCompanyId(null);
                    loadFleet();
                  }}
                  onCancel={() => {
                    setSettingsOpen(false);
                    setSelectedCompanyId(null);
                  }}
                />
                <div className="border-t pt-6">
                  <CompanyDocuments companyId={selectedCompanyId} />
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </AdminLayout>
  );
}
