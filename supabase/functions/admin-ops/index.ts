import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSignedA2UISession, A2UISurfaceType } from "../_shared/a2ui-token.ts";
import { normalizeDigits, sendMarketerWhatsApp } from "../_shared/marketer-twilio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getLusakaTodayStartIso(): string {
  const offsetMs = 2 * 60 * 60 * 1000; // Africa/Lusaka is UTC+2 (no DST)
  const localMs = Date.now() + offsetMs;
  const midnightLocalMs = Math.floor(localMs / 86_400_000) * 86_400_000;
  return new Date(midnightLocalMs - offsetMs).toISOString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonRes({ error: "Authorization header required" }, 401);
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser(token);

    if (authErr || !user) {
      return jsonRes({ error: "Invalid authentication token" }, 401);
    }

    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (roleErr || !isAdmin) {
      return jsonRes({ error: "Platform admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    // ── ACTION: fleet_summary ───────────────────────────────────────────
    if (action === "fleet_summary") {
      const todayStart = getLusakaTodayStartIso();
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [
        companiesRes,
        membersRes,
        todayConvsRes,
        todayMsgsRes,
        bmsConnRes,
        bmsHealthRes,
        metaCredsRes,
        socialCredsRes,
        waCloudRes,
        openErrorsRes,
        openViolationsRes,
        pendingMediaRes,
        recentVideoRes,
        spendingRes,
        claimCodesRes,
      ] = await Promise.all([
        supabase.from("companies").select("*").order("created_at", { ascending: false }),
        supabase.from("company_users").select("company_id, user_id, role"),
        supabase
          .from("conversations")
          .select("id, company_id")
          .gte("last_message_at", todayStart)
          .limit(5000),
        supabase
          .from("messages")
          .select("conversation_id")
          .eq("role", "assistant")
          .gte("created_at", todayStart)
          .limit(5000),
        supabase.from("bms_connections").select("company_id, is_active, bms_type"),
        supabase
          .from("bms_health_log")
          .select("company_id, status, latency_ms, checked_at, error_message")
          .gte("checked_at", since24h)
          .order("checked_at", { ascending: false })
          .limit(500),
        supabase
          .from("meta_credentials")
          .select("company_id, page_id, page_name, ig_user_id, health_status, connection_state, last_verified_at"),
        supabase
          .from("social_credentials")
          .select("company_id, platform, account_name, token_expires_at, refresh_expires_at"),
        supabase
          .from("company_whatsapp_cloud")
          .select("company_id, display_phone_number, health_status"),
        supabase.from("ai_error_logs").select("company_id").eq("status", "open").limit(2000),
        supabase.from("rule_violations").select("company_id").eq("reviewed", false).limit(2000),
        supabase
          .from("company_media")
          .select("company_id")
          .eq("asset_validation_status", "pending")
          .limit(2000),
        supabase
          .from("video_generation_jobs")
          .select("company_id, status")
          .gte("created_at", since24h)
          .limit(500),
        supabase.from("agent_spending_limits").select("*"),
        supabase.from("company_claim_codes").select("company_id, code, claimed_at"),
      ]);

      if (companiesRes.error) throw companiesRes.error;
      const companies = companiesRes.data || [];

      const convToCompany = new Map<string, string>();
      for (const c of todayConvsRes.data || []) {
        if (c.company_id) convToCompany.set(c.id, c.company_id);
      }

      const repliesTodayByCompany = new Map<string, number>();
      for (const m of todayMsgsRes.data || []) {
        const cid = convToCompany.get(m.conversation_id);
        if (cid) {
          repliesTodayByCompany.set(cid, (repliesTodayByCompany.get(cid) || 0) + 1);
        }
      }

      const memberCountByCompany = new Map<string, number>();
      for (const mu of membersRes.data || []) {
        memberCountByCompany.set(mu.company_id, (memberCountByCompany.get(mu.company_id) || 0) + 1);
      }

      const bmsConnByCompany = new Map<string, { is_active: boolean; bms_type: string }>();
      for (const bc of bmsConnRes.data || []) {
        bmsConnByCompany.set(bc.company_id, { is_active: bc.is_active, bms_type: bc.bms_type });
      }

      const latestBmsHealth = new Map<string, { status: string; latency_ms: number | null; checked_at: string; error_message: string | null }>();
      for (const bh of bmsHealthRes.data || []) {
        if (!latestBmsHealth.has(bh.company_id)) {
          latestBmsHealth.set(bh.company_id, {
            status: bh.status,
            latency_ms: bh.latency_ms,
            checked_at: bh.checked_at,
            error_message: bh.error_message,
          });
        }
      }

      const metaByCompany = new Map<string, any[]>();
      for (const mc of metaCredsRes.data || []) {
        if (!mc.company_id) continue;
        const arr = metaByCompany.get(mc.company_id) || [];
        arr.push(mc);
        metaByCompany.set(mc.company_id, arr);
      }

      const socialByCompany = new Map<string, any[]>();
      for (const sc of socialCredsRes.data || []) {
        const arr = socialByCompany.get(sc.company_id) || [];
        arr.push(sc);
        socialByCompany.set(sc.company_id, arr);
      }

      const waCloudByCompany = new Map<string, any>();
      for (const wc of waCloudRes.data || []) {
        waCloudByCompany.set(wc.company_id, wc);
      }

      const openErrorsByCompany = new Map<string, number>();
      for (const e of openErrorsRes.data || []) {
        openErrorsByCompany.set(e.company_id, (openErrorsByCompany.get(e.company_id) || 0) + 1);
      }

      const openViolationsByCompany = new Map<string, number>();
      for (const v of openViolationsRes.data || []) {
        openViolationsByCompany.set(v.company_id, (openViolationsByCompany.get(v.company_id) || 0) + 1);
      }

      const pendingMediaByCompany = new Map<string, number>();
      for (const pm of pendingMediaRes.data || []) {
        pendingMediaByCompany.set(pm.company_id, (pendingMediaByCompany.get(pm.company_id) || 0) + 1);
      }

      const pendingVideosByCompany = new Map<string, number>();
      for (const vj of recentVideoRes.data || []) {
        if (vj.status === "pending") {
          pendingVideosByCompany.set(vj.company_id, (pendingVideosByCompany.get(vj.company_id) || 0) + 1);
        }
      }

      const spendingByCompany = new Map<string, any>();
      for (const sp of spendingRes.data || []) {
        spendingByCompany.set(sp.company_id, sp);
      }

      const claimByCompany = new Map<string, { code: string; claimed_at: string | null }>();
      for (const cc of claimCodesRes.data || []) {
        claimByCompany.set(cc.company_id, { code: cc.code, claimed_at: cc.claimed_at });
      }

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();

      let totalRepliesToday = 0;
      let productionCount = 0;
      let needsAttentionCount = 0;
      let degradedBmsCount = 0;
      let expiringTokensCount = 0;
      let pendingMediaTotal = 0;

      const fleetRows = companies.map((company: any) => {
        const md = (company.metadata as Record<string, any> | null) || {};
        const harnessMode = String(md.harness_mode || "off");
        const metaList = metaByCompany.get(company.id) || [];
        const socialList = socialByCompany.get(company.id) || [];
        const waCloud = waCloudByCompany.get(company.id) || null;
        const bmsConn = bmsConnByCompany.get(company.id) || null;
        const bmsHealth = latestBmsHealth.get(company.id) || null;
        const openErrors = openErrorsByCompany.get(company.id) || 0;
        const openViolations = openViolationsByCompany.get(company.id) || 0;
        const pendingMedia = pendingMediaByCompany.get(company.id) || 0;
        const repliesToday = repliesTodayByCompany.get(company.id) || 0;

        const hasExpiringSocial = socialList.some((s: any) => {
          if (!s.token_expires_at) return false;
          const exp = new Date(s.token_expires_at).getTime();
          return !Number.isNaN(exp) && exp - nowMs < sevenDaysMs;
        });
        const hasUnhealthyMeta = metaList.some(
          (m: any) => m.health_status && m.health_status !== "healthy"
        );
        const hasUnhealthyWa = !!(waCloud && waCloud.health_status && waCloud.health_status !== "healthy");
        const tokenIssue = hasExpiringSocial || hasUnhealthyMeta || hasUnhealthyWa;

        const bmsStatus = !bmsConn
          ? "none"
          : !bmsConn.is_active
          ? "inactive"
          : bmsHealth?.status || "unknown";

        const isDegradedBms = bmsStatus === "degraded" || bmsStatus === "down";
        const lowCredits = Number(company.credit_balance ?? 0) < 50;
        const attentionReasons: string[] = [];
        if (openErrors > 0) attentionReasons.push(`${openErrors} AI error${openErrors > 1 ? "s" : ""}`);
        if (openViolations > 0) attentionReasons.push(`${openViolations} rule violation${openViolations > 1 ? "s" : ""}`);
        if (isDegradedBms) attentionReasons.push(`BMS ${bmsStatus}`);
        if (tokenIssue) attentionReasons.push("Channel token expiring/unhealthy");
        if (lowCredits) attentionReasons.push("Low credits");

        totalRepliesToday += repliesToday;
        if (!company.test_mode) productionCount += 1;
        if (attentionReasons.length > 0) needsAttentionCount += 1;
        if (isDegradedBms) degradedBmsCount += 1;
        if (tokenIssue) expiringTokensCount += 1;
        pendingMediaTotal += pendingMedia;

        const platforms = {
          whatsapp: Boolean(company.whatsapp_number || waCloud),
          facebook: metaList.some((m: any) => Boolean(m.page_id)),
          instagram: metaList.some((m: any) => Boolean(m.ig_user_id)),
          linkedin: socialList.some((s: any) => String(s.platform).includes("linkedin")),
          tiktok: socialList.some((s: any) => String(s.platform).includes("tiktok")),
        };

        return {
          company,
          member_count: memberCountByCompany.get(company.id) || 0,
          harness_mode: harnessMode,
          ai_replies_today: repliesToday,
          bms_status: bmsStatus,
          bms_latency_ms: bmsHealth?.latency_ms ?? null,
          bms_checked_at: bmsHealth?.checked_at ?? null,
          bms_error: bmsHealth?.error_message ?? null,
          platforms,
          token_issue: tokenIssue,
          open_errors: openErrors,
          open_violations: openViolations,
          pending_media: pendingMedia,
          pending_videos: pendingVideosByCompany.get(company.id) || 0,
          claim: claimByCompany.get(company.id) || null,
          spending_limits: spendingByCompany.get(company.id) || null,
          attention_reasons: attentionReasons,
        };
      });

      return jsonRes({
        companies: fleetRows,
        totals: {
          total_companies: companies.length,
          production_companies: productionCount,
          ai_replies_today: totalRepliesToday,
          needs_attention: needsAttentionCount,
          degraded_bms: degradedBmsCount,
          expiring_tokens: expiringTokensCount,
          pending_media: pendingMediaTotal,
        },
      });
    }

    // ── ACTION: probes ──────────────────────────────────────────────────
    if (action === "probes") {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const harnessUrl = (Deno.env.get("OMANUT_HARNESS_URL") || "").replace(/\/+$/, "");

      const harnessPromise = (async () => {
        if (!harnessUrl) {
          return { configured: false, url_host: null, ok: false, status: null, latency_ms: null, payload: null };
        }
        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const r = await fetch(`${harnessUrl}/health`, { signal: controller.signal });
          const latency_ms = Date.now() - started;
          const payload = await r.json().catch(() => null);
          let host: string | null = null;
          try {
            host = new URL(harnessUrl).host;
          } catch {
            host = harnessUrl;
          }
          return { configured: true, url_host: host, ok: r.ok, status: r.status, latency_ms, payload };
        } catch (err) {
          return {
            configured: true,
            url_host: harnessUrl,
            ok: false,
            status: null,
            latency_ms: Date.now() - started,
            payload: { error: err instanceof Error ? err.message : String(err) },
          };
        } finally {
          clearTimeout(timer);
        }
      })();

      const [
        harnessHealth,
        companiesRes,
        events24hRes,
        dlqRes,
        metricsRes,
        lastBmsRes,
        lastWaRes,
        lastMetaRes,
        lastVideoRes,
        lastPostRes,
        socialCredsRes,
        metaCredsRes,
        waCloudRes,
      ] = await Promise.all([
        harnessPromise,
        supabase.from("companies").select("id, name"),
        supabase
          .from("inbound_events")
          .select("status, latency_ms, error_class")
          .gte("created_at", since24h)
          .limit(3000),
        supabase
          .from("inbound_events")
          .select("id, company_id, conversation_id, channel, source, status, attempts, error_class, last_error, payload, created_at, updated_at")
          .in("status", ["failed", "dead", "processing"])
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("system_metrics")
          .select("id, metric, value, recorded_at, company_id, tags")
          .gte("recorded_at", since24h)
          .order("recorded_at", { ascending: false })
          .limit(200),
        supabase.from("bms_health_log").select("checked_at, status").order("checked_at", { ascending: false }).limit(1),
        supabase
          .from("inbound_events")
          .select("created_at, status")
          .eq("channel", "whatsapp")
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("inbound_events")
          .select("created_at, status")
          .in("channel", ["direct_message", "public_comment"])
          .order("created_at", { ascending: false })
          .limit(1),
        supabase.from("video_generation_jobs").select("updated_at, status").order("updated_at", { ascending: false }).limit(1),
        supabase
          .from("scheduled_posts")
          .select("updated_at, status")
          .eq("status", "published")
          .order("updated_at", { ascending: false })
          .limit(1),
        supabase
          .from("social_credentials")
          .select("id, company_id, platform, account_name, token_expires_at, refresh_expires_at"),
        supabase
          .from("meta_credentials")
          .select("id, company_id, page_name, health_status, connection_state, last_verified_at"),
        supabase
          .from("company_whatsapp_cloud")
          .select("company_id, display_phone_number, health_status, last_verified_at"),
      ]);

      const companyMap: Record<string, string> = {};
      for (const c of companiesRes.data || []) {
        companyMap[c.id] = c.name;
      }

      const byStatus = new Map<string, { count: number; lat: number; n: number }>();
      const byErr = new Map<string, number>();
      for (const e of events24hRes.data || []) {
        const s = byStatus.get(e.status) || { count: 0, lat: 0, n: 0 };
        s.count += 1;
        if (e.latency_ms) {
          s.lat += e.latency_ms;
          s.n += 1;
        }
        byStatus.set(e.status, s);
        if (e.error_class) {
          byErr.set(e.error_class, (byErr.get(e.error_class) || 0) + 1);
        }
      }

      const envReadiness = {
        DEEPSEEK_API_KEY: Boolean(Deno.env.get("DEEPSEEK_API_KEY")),
        ZHIPU_API_KEY: Boolean(Deno.env.get("ZHIPU_API_KEY")),
        KIMI_API_KEY: Boolean(Deno.env.get("KIMI_API_KEY")),
        GEMINI_API_KEY: Boolean(Deno.env.get("GEMINI_API_KEY")),
        MINIMAX_API_KEY: Boolean(Deno.env.get("MINIMAX_API_KEY")),
        OPENAI_API_KEY: Boolean(Deno.env.get("OPENAI_API_KEY")),
        FAL_KEY: Boolean(Deno.env.get("FAL_KEY")),
        OMANUT_HARNESS_URL: Boolean(Deno.env.get("OMANUT_HARNESS_URL")),
        TWILIO_ACCOUNT_SID: Boolean(Deno.env.get("TWILIO_ACCOUNT_SID")),
        META_APP_ID: Boolean(Deno.env.get("META_APP_ID")),
      };

      const heartbeats = [
        {
          id: "bms_health_check",
          label: "BMS Health Monitor",
          last_at: lastBmsRes.data?.[0]?.checked_at || null,
          last_status: lastBmsRes.data?.[0]?.status || null,
          expected_minutes: 15,
        },
        {
          id: "whatsapp_pipeline",
          label: "WhatsApp Event Pipeline",
          last_at: lastWaRes.data?.[0]?.created_at || null,
          last_status: lastWaRes.data?.[0]?.status || null,
          expected_minutes: 1440,
        },
        {
          id: "meta_auto_reply",
          label: "Meta Auto-Reply (FB/IG)",
          last_at: lastMetaRes.data?.[0]?.created_at || null,
          last_status: lastMetaRes.data?.[0]?.status || null,
          expected_minutes: 1440,
        },
        {
          id: "video_poller",
          label: "Video Poller (Omanut Motion)",
          last_at: lastVideoRes.data?.[0]?.updated_at || null,
          last_status: lastVideoRes.data?.[0]?.status || null,
          expected_minutes: 4320,
        },
        {
          id: "cron_publisher",
          label: "Social Post Publisher",
          last_at: lastPostRes.data?.[0]?.updated_at || null,
          last_status: lastPostRes.data?.[0]?.status || null,
          expected_minutes: 4320,
        },
      ];

      const nowMs = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const channelAlerts: Array<{
        company_id: string;
        company_name: string;
        platform: string;
        account_label: string;
        issue: string;
        expires_at?: string | null;
      }> = [];

      for (const sc of socialCredsRes.data || []) {
        if (!sc.token_expires_at) continue;
        const expMs = new Date(sc.token_expires_at).getTime();
        if (Number.isNaN(expMs)) continue;
        if (expMs <= nowMs) {
          channelAlerts.push({
            company_id: sc.company_id,
            company_name: companyMap[sc.company_id] || sc.company_id,
            platform: sc.platform,
            account_label: sc.account_name || sc.platform,
            issue: "Token expired",
            expires_at: sc.token_expires_at,
          });
        } else if (expMs - nowMs < sevenDaysMs) {
          const days = Math.max(1, Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000)));
          channelAlerts.push({
            company_id: sc.company_id,
            company_name: companyMap[sc.company_id] || sc.company_id,
            platform: sc.platform,
            account_label: sc.account_name || sc.platform,
            issue: `Expires in ${days}d`,
            expires_at: sc.token_expires_at,
          });
        }
      }

      for (const mc of metaCredsRes.data || []) {
        if (mc.health_status && mc.health_status !== "healthy") {
          channelAlerts.push({
            company_id: mc.company_id || "",
            company_name: (mc.company_id && companyMap[mc.company_id]) || "Unknown",
            platform: "meta",
            account_label: mc.page_name || "Meta Page",
            issue: `Status: ${mc.health_status} (${mc.connection_state})`,
            expires_at: mc.last_verified_at,
          });
        }
      }

      for (const wc of waCloudRes.data || []) {
        if (wc.health_status && wc.health_status !== "healthy") {
          channelAlerts.push({
            company_id: wc.company_id,
            company_name: companyMap[wc.company_id] || wc.company_id,
            platform: "whatsapp_cloud",
            account_label: wc.display_phone_number,
            issue: `Status: ${wc.health_status}`,
            expires_at: wc.last_verified_at,
          });
        }
      }

      return jsonRes({
        harness: harnessHealth,
        env_readiness: envReadiness,
        heartbeats,
        channel_alerts: channelAlerts,
        event_stats: Array.from(byStatus.entries()).map(([status, v]) => ({
          status,
          count: v.count,
          avg_latency: v.n ? Math.round(v.lat / v.n) : null,
        })),
        error_classes: Array.from(byErr.entries()).map(([error_class, count]) => ({
          error_class,
          count,
        })),
        dlq_events: (dlqRes.data || []).map((ev: any) => ({
          ...ev,
          company_name: companyMap[ev.company_id] || ev.company_id,
        })),
        metrics: (metricsRes.data || []).map((m: any) => ({
          ...m,
          company_name: m.company_id ? companyMap[m.company_id] || m.company_id : null,
        })),
      });
    }

    // ── ACTION: replay_event ────────────────────────────────────────────
    if (action === "replay_event") {
      const eventId = String(body?.event_id || "").trim();
      if (!eventId) return jsonRes({ error: "event_id is required" }, 400);

      const { data: ev, error: fetchErr } = await supabase
        .from("inbound_events")
        .select("id, company_id, channel, source, status")
        .eq("id", eventId)
        .maybeSingle();

      if (fetchErr || !ev) return jsonRes({ error: "Event not found" }, 404);

      const { error: updErr } = await supabase
        .from("inbound_events")
        .update({
          status: "pending",
          next_attempt_at: new Date().toISOString(),
          attempts: 0,
          claimed_at: null,
          claimed_by: null,
          last_error: null,
          error_class: null,
        })
        .eq("id", eventId);

      if (updErr) throw updErr;

      await supabase.from("security_events").insert({
        source: "admin_ui",
        event_type: "admin_event_replay",
        severity: "info",
        company_id: ev.company_id,
        user_id: user.id,
        message: `Replayed ${ev.channel}/${ev.source} inbound event ${eventId}`,
        details: { event_id: eventId, previous_status: ev.status },
      });

      return jsonRes({ ok: true, event_id: eventId });
    }

    // ── ACTION: dismiss_event ───────────────────────────────────────────
    if (action === "dismiss_event") {
      const eventId = String(body?.event_id || "").trim();
      const reason = String(body?.reason || "Dismissed by admin").trim();
      if (!eventId) return jsonRes({ error: "event_id is required" }, 400);

      const { data: ev, error: fetchErr } = await supabase
        .from("inbound_events")
        .select("id, company_id, channel, source, status")
        .eq("id", eventId)
        .maybeSingle();

      if (fetchErr || !ev) return jsonRes({ error: "Event not found" }, 404);

      const { error: updErr } = await supabase
        .from("inbound_events")
        .update({
          status: "skipped",
          last_error: reason,
        })
        .eq("id", eventId);

      if (updErr) throw updErr;

      await supabase.from("security_events").insert({
        source: "admin_ui",
        event_type: "admin_event_dismiss",
        severity: "info",
        company_id: ev.company_id,
        user_id: user.id,
        message: `Dismissed ${ev.channel}/${ev.source} inbound event ${eventId}: ${reason}`,
        details: { event_id: eventId, previous_status: ev.status, reason },
      });

      return jsonRes({ ok: true, event_id: eventId });
    }

    // ── ACTION: update_spending_limits ──────────────────────────────────
    if (action === "update_spending_limits") {
      const companyId = String(body?.company_id || "").trim();
      if (!companyId) return jsonRes({ error: "company_id is required" }, 400);

      const payload = {
        company_id: companyId,
        daily_ad_budget_limit: Number(body?.daily_ad_budget_limit ?? 50),
        sale_approval_threshold: Number(body?.sale_approval_threshold ?? 500),
        require_approval_for_ai_config: Boolean(body?.require_approval_for_ai_config ?? true),
        require_approval_for_publishing: Boolean(body?.require_approval_for_publishing ?? false),
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error: upsertErr } = await supabase
        .from("agent_spending_limits")
        .upsert(payload, { onConflict: "company_id" })
        .select("*")
        .single();

      if (upsertErr) throw upsertErr;

      await supabase.from("security_events").insert({
        source: "admin_ui",
        event_type: "admin_spending_limits_updated",
        severity: "info",
        company_id: companyId,
        user_id: user.id,
        message: `Updated spending & approval guardrails for company ${companyId}`,
        details: payload,
      });

      return jsonRes({ ok: true, limits: saved });
    }

    // ── ACTION: list_marketer_overview ────────────────────────────────────
    if (action === "list_marketer_overview") {
      const [subsRes, paymentsRes, metaRes, socialRes, vaultRes, postsRes, plansRes] = await Promise.all([
        supabase
          .from("marketer_subscriptions")
          .select("*, companies(id, name, business_type, services, is_live, metadata)")
          .order("created_at", { ascending: false }),
        supabase
          .from("marketer_payments")
          .select("*, companies(name)")
          .order("paid_at", { ascending: false })
          .limit(50),
        supabase.from("meta_credentials").select("company_id, page_name, ig_user_id"),
        supabase.from("social_credentials").select("company_id, platform, account_name"),
        supabase
          .from("company_media")
          .select("company_id, vault_status")
          .in("vault_status", ["ready", "evergreen"]),
        supabase
          .from("scheduled_posts")
          .select("company_id, status"),
        supabase
          .from("marketer_plans")
          .select("*")
          .eq("is_active", true)
          .order("default_monthly_fee", { ascending: true }),
      ]);

      if (subsRes.error) throw subsRes.error;

      const metaByCo = new Map<string, Array<{ page_name: string | null; ig_user_id: string | null }>>();
      for (const m of metaRes.data || []) {
        if (!m.company_id) continue;
        const arr = metaByCo.get(m.company_id) || [];
        arr.push({ page_name: m.page_name, ig_user_id: m.ig_user_id });
        metaByCo.set(m.company_id, arr);
      }

      const socialByCo = new Map<string, string[]>();
      for (const s of socialRes.data || []) {
        const arr = socialByCo.get(s.company_id) || [];
        arr.push(s.platform);
        socialByCo.set(s.company_id, arr);
      }

      const vaultByCo = new Map<string, number>();
      for (const v of vaultRes.data || []) {
        vaultByCo.set(v.company_id, (vaultByCo.get(v.company_id) || 0) + 1);
      }

      const postsByCo = new Map<string, { queued: number; published: number }>();
      for (const p of postsRes.data || []) {
        const cur = postsByCo.get(p.company_id) || { queued: 0, published: 0 };
        if (p.status === "published") cur.published += 1;
        else if (["draft", "pending_approval", "approved", "scheduled"].includes(p.status)) cur.queued += 1;
        postsByCo.set(p.company_id, cur);
      }

      const enrichedSubs = (subsRes.data || []).map((s) => ({
        ...s,
        connected_meta: metaByCo.get(s.company_id) || [],
        connected_social: socialByCo.get(s.company_id) || [],
        vault_ready_count: vaultByCo.get(s.company_id) || 0,
        post_counts: postsByCo.get(s.company_id) || { queued: 0, published: 0 },
      }));

      return jsonRes({
        ok: true,
        subscriptions: enrichedSubs,
        payments: paymentsRes.data || [],
        plans: plansRes.data || [],
      });
    }

    // ── ACTION: provision_marketer_client ─────────────────────────────────
    if (action === "provision_marketer_client") {
      const mode = String(body?.mode || "create_new");
      const phone = normalizeDigits(String(body?.primary_whatsapp_phone || ""));
      if (!phone || phone.length < 9) {
        return jsonRes({ error: "Valid primary WhatsApp phone number is required" }, 400);
      }

      let companyId = typeof body?.company_id === "string" ? body.company_id.trim() : "";
      let companyName = String(body?.company_name || "").trim();

      if (mode === "create_new") {
        if (!companyName) return jsonRes({ error: "company_name is required" }, 400);
        const { data: createdCo, error: coErr } = await supabase
          .from("companies")
          .insert({
            name: companyName,
            business_type: String(body?.business_type || "business"),
            services: body?.services ? String(body.services) : null,
            whatsapp_number: null,
            twilio_number: null,
            is_live: true,
            image_gen_unlocked: true,
            metadata: { product_mode: "social_marketer_only", provisioned_via: "admin_saas" },
          })
          .select("id, name")
          .single();

        if (coErr || !createdCo) throw coErr || new Error("Failed to create company");
        companyId = createdCo.id;
        companyName = createdCo.name;

        await Promise.all([
          supabase.from("company_users").insert({
            company_id: companyId,
            user_id: user.id,
            role: "owner",
          }),
          supabase.from("brand_kits").upsert({
            company_id: companyId,
            tone: body?.brand_tone ? String(body.brand_tone) : "warm, vibrant, trustworthy",
            updated_by: user.id,
          }, { onConflict: "company_id" }),
          supabase.from("image_generation_settings").upsert({
            company_id: companyId,
            enabled: true,
            brand_tone: body?.brand_tone ? String(body.brand_tone) : "warm, vibrant, trustworthy",
          }, { onConflict: "company_id" }),
        ]);
      } else {
        if (!companyId) return jsonRes({ error: "company_id is required when attaching" }, 400);
        const { data: existingCo } = await supabase.from("companies").select("id, name").eq("id", companyId).single();
        if (!existingCo) return jsonRes({ error: "Company not found" }, 404);
        companyName = existingCo.name;
      }

      const setupFee = Number(body?.setup_fee_amount ?? 0);
      const monthlyFee = Number(body?.monthly_fee_amount ?? 0);
      const setupPaid = Boolean(body?.setup_fee_paid ?? true);
      const postsLimit = Number(body?.monthly_posts_limit ?? 16);
      const imagesLimit = Number(body?.monthly_images_limit ?? 15);
      const videosLimit = Number(body?.monthly_videos_limit ?? 4);
      const autopilotLevel = String(body?.autopilot_level || "copilot");

      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 86_400_000).toISOString();

      const { data: subRow, error: subErr } = await supabase
        .from("marketer_subscriptions")
        .upsert({
          company_id: companyId,
          plan_id: body?.plan_id || null,
          primary_whatsapp_phone: phone,
          contact_name: body?.contact_name ? String(body.contact_name).trim() : null,
          status: setupPaid ? "active" : "setup_pending",
          currency: String(body?.currency || "ZMW"),
          setup_fee_amount: setupFee,
          setup_fee_paid: setupPaid,
          setup_fee_paid_at: setupPaid ? now.toISOString() : null,
          monthly_fee_amount: monthlyFee,
          current_period_start: now.toISOString(),
          current_period_end: periodEnd,
          monthly_posts_limit: postsLimit,
          monthly_images_limit: imagesLimit,
          monthly_videos_limit: videosLimit,
          autopilot_level: autopilotLevel,
          notes: body?.notes ? String(body.notes) : null,
          provisioned_by: user.id,
        }, { onConflict: "company_id" })
        .select("*")
        .single();

      if (subErr || !subRow) throw subErr || new Error("Failed to save marketer subscription");

      const initialPayment = Number(body?.initial_payment_amount ?? (setupPaid ? setupFee + monthlyFee : 0));
      if (initialPayment > 0) {
        await supabase.from("marketer_payments").insert({
          company_id: companyId,
          subscription_id: subRow.id,
          payment_type: setupFee > 0 && monthlyFee > 0 ? "setup_and_first_month" : setupFee > 0 ? "setup_fee" : "monthly_renewal",
          amount: initialPayment,
          currency: String(body?.currency || "ZMW"),
          provider: String(body?.payment_provider || "manual_momo"),
          reference_code: body?.reference_code ? String(body.reference_code).trim() : null,
          notes: "Initial setup recorded during client onboarding",
          status: "paid",
          recorded_by: user.id,
        });
      }

      const studio = await createSignedA2UISession(supabase, {
        companyId,
        phone,
        surfaceType: "onboarding_hub",
        ttlHours: 48,
        uiSpec: { headline: `Welcome ${companyName}! Connect your social pages & upload initial content.` },
      });

      let whatsappSent = false;
      if (body?.send_welcome_whatsapp !== false) {
        const contact = body?.contact_name ? ` ${String(body.contact_name).trim()}` : "";
        const sendRes = await sendMarketerWhatsApp({
          to: phone,
          body: `🎉 *Welcome to Omanut AI Social Marketer,${contact}!*\n\nYour AI Marketer for *${companyName}* is live right here on WhatsApp.\n\n*Step 1 — 30-Second Setup Studio (no password needed):*\n👉 ${studio.url}\n\nInside that link you can:\n1. Connect your Facebook Page & Instagram\n2. Upload your existing photos & videos into your Vault\n3. Set your Brand colors & tone\n\nOr simply drop a photo or voice note right here and tell me what we should post first!`,
        });
        whatsappSent = sendRes.ok;
      }

      return jsonRes({
        ok: true,
        subscription: subRow,
        studio_url: studio.url,
        whatsapp_sent: whatsappSent,
      });
    }

    // ── ACTION: update_marketer_subscription ──────────────────────────────
    if (action === "update_marketer_subscription") {
      const subId = String(body?.subscription_id || "").trim();
      if (!subId) return jsonRes({ error: "subscription_id is required" }, 400);

      const patch: Record<string, unknown> = {};
      if (typeof body?.status === "string") patch.status = body.status;
      if (body?.setup_fee_amount !== undefined) patch.setup_fee_amount = Number(body.setup_fee_amount);
      if (typeof body?.setup_fee_paid === "boolean") {
        patch.setup_fee_paid = body.setup_fee_paid;
        if (body.setup_fee_paid) patch.setup_fee_paid_at = new Date().toISOString();
      }
      if (body?.monthly_fee_amount !== undefined) patch.monthly_fee_amount = Number(body.monthly_fee_amount);
      if (body?.monthly_posts_limit !== undefined) patch.monthly_posts_limit = Number(body.monthly_posts_limit);
      if (body?.monthly_images_limit !== undefined) patch.monthly_images_limit = Number(body.monthly_images_limit);
      if (body?.monthly_videos_limit !== undefined) patch.monthly_videos_limit = Number(body.monthly_videos_limit);
      if (typeof body?.autopilot_level === "string") patch.autopilot_level = body.autopilot_level;
      if (typeof body?.primary_whatsapp_phone === "string") {
        patch.primary_whatsapp_phone = normalizeDigits(body.primary_whatsapp_phone);
      }
      if (typeof body?.contact_name === "string") patch.contact_name = body.contact_name;
      if (typeof body?.notes === "string") patch.notes = body.notes;
      if (body?.reset_usage === true) {
        patch.usage_posts_used = 0;
        patch.usage_images_used = 0;
        patch.usage_videos_used = 0;
        patch.usage_reset_at = new Date().toISOString();
      }

      const { data: updated, error: upErr } = await supabase
        .from("marketer_subscriptions")
        .update(patch)
        .eq("id", subId)
        .select("*")
        .single();

      if (upErr) throw upErr;
      return jsonRes({ ok: true, subscription: updated });
    }

    // ── ACTION: record_marketer_payment ───────────────────────────────────
    if (action === "record_marketer_payment") {
      const subId = String(body?.subscription_id || "").trim();
      const amount = Number(body?.amount ?? 0);
      if (!subId || amount <= 0) return jsonRes({ error: "subscription_id and positive amount required" }, 400);

      const { data: sub } = await supabase
        .from("marketer_subscriptions")
        .select("*, companies(name)")
        .eq("id", subId)
        .single();

      if (!sub) return jsonRes({ error: "Subscription not found" }, 404);

      const paymentType = String(body?.payment_type || "monthly_renewal");
      const { data: paymentRow, error: payErr } = await supabase
        .from("marketer_payments")
        .insert({
          company_id: sub.company_id,
          subscription_id: sub.id,
          payment_type: paymentType,
          amount,
          currency: String(body?.currency || sub.currency || "ZMW"),
          provider: String(body?.provider || "manual_momo"),
          reference_code: body?.reference_code ? String(body.reference_code).trim() : null,
          notes: body?.notes ? String(body.notes).trim() : null,
          status: "paid",
          recorded_by: user.id,
        })
        .select("*")
        .single();

      if (payErr) throw payErr;

      const subPatch: Record<string, unknown> = { status: "active" };
      if (paymentType === "setup_fee" || paymentType === "setup_and_first_month") {
        subPatch.setup_fee_paid = true;
        subPatch.setup_fee_paid_at = new Date().toISOString();
      }
      if (body?.extend_month !== false && (paymentType === "monthly_renewal" || paymentType === "setup_and_first_month")) {
        const baseMs = Math.max(Date.now(), Date.parse(sub.current_period_end || "") || Date.now());
        subPatch.current_period_start = new Date().toISOString();
        subPatch.current_period_end = new Date(baseMs + 30 * 86_400_000).toISOString();
        subPatch.grace_until = null;
        if (body?.reset_usage !== false) {
          subPatch.usage_posts_used = 0;
          subPatch.usage_images_used = 0;
          subPatch.usage_videos_used = 0;
          subPatch.usage_reset_at = new Date().toISOString();
        }
      }

      await supabase.from("marketer_subscriptions").update(subPatch).eq("id", sub.id);

      let whatsappSent = false;
      if (body?.send_whatsapp_receipt !== false && sub.primary_whatsapp_phone) {
        const coName = (sub.companies as { name?: string } | null)?.name || "your brand";
        const sendRes = await sendMarketerWhatsApp({
          to: sub.primary_whatsapp_phone,
          body: `✅ *Payment Received — ${coName}*\n\nAmount: *${sub.currency} ${amount}* (${paymentType.replace(/_/g, " ")})\nStatus: *Active*\n\nThank you! Let's keep creating & scheduling winning content for you.`,
        });
        whatsappSent = sendRes.ok;
      }

      return jsonRes({ ok: true, payment: paymentRow, whatsapp_sent: whatsappSent });
    }

    // ── ACTION: mint_client_studio_link ───────────────────────────────────
    if (action === "mint_client_studio_link") {
      const subId = String(body?.subscription_id || "").trim();
      const surface = String(body?.surface_type || "onboarding_hub") as A2UISurfaceType;
      if (!subId) return jsonRes({ error: "subscription_id is required" }, 400);

      const { data: sub } = await supabase
        .from("marketer_subscriptions")
        .select("*, companies(name)")
        .eq("id", subId)
        .single();
      if (!sub) return jsonRes({ error: "Subscription not found" }, 404);

      const studio = await createSignedA2UISession(supabase, {
        companyId: sub.company_id,
        phone: sub.primary_whatsapp_phone,
        surfaceType: surface,
        ttlHours: 48,
      });

      let whatsappSent = false;
      if (body?.send_whatsapp === true) {
        const coName = (sub.companies as { name?: string } | null)?.name || "your brand";
        const res = await sendMarketerWhatsApp({
          to: sub.primary_whatsapp_phone,
          body: `✨ Here is your quick *${coName}* Mobile Studio link (${surface.replace(/_/g, " ")}):\n👉 ${studio.url}`,
        });
        whatsappSent = res.ok;
      }

      return jsonRes({ ok: true, studio_url: studio.url, whatsapp_sent: whatsappSent });
    }

    // ── ACTION: trigger_marketer_ritual ───────────────────────────────────
    if (action === "trigger_marketer_ritual") {
      const companyId = String(body?.company_id || "").trim();
      const jobType = String(body?.job_type || "monday_kickoff");
      const cronRes = await fetch(`${supabaseUrl}/functions/v1/marketer-proactive-cron`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_type: jobType, company_id: companyId || undefined }),
      });
      const cronJson = await cronRes.json().catch(() => ({}));
      return jsonRes(cronJson, cronRes.status);
    }

    return jsonRes({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[admin-ops] error:", err);
    return jsonRes(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
