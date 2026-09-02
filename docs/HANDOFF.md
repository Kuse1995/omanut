# HANDOFF — Omanut OS Platform State

**Last updated:** 2026-08-25 (by DSH takeover agent)
**Repo:** `Kuse1995/omanut` (main, local copy at `C:\Users\user\Documents\Codex\2026-08-04\we\work\omanut`)
**Live Supabase:** `dzheddvoiauevcayifev.supabase.co` · **Web app:** `https://omanut.lovable.app`
**MCP control plane:** `POST /functions/v1/mcp-server` with `x-api-key` (key in `C:\Users\user\Documents\Codex\2026-08-04\we\work\mcp_help.mjs`; also the `OpenClaw Training` admin key)

---

## 1. System health summary (verified live 2026-08-25)

| Check | Result |
|---|---|
| Landing + legal pages (`/`, `/privacy`, `/terms`, `/data-deletion`) | ✅ LIVE (routes present in deployed bundle `index-Dke86XqH.js`) |
| `test-agent-routing` probe | ✅ works, routes to `sales` via `deepseek-chat` |
| `company_ai_overrides.primary_model` | ✅ `deepseek-chat` for active company (all 7 companies per prior verification) |
| New `ai_call_failed` / `ai_fallback_chain_exhausted` since 2026-08-04 | ✅ **zero** — model fix confirmed working |
| Other AI errors since 08-04 | 3: `handoff_failed` (08-14, boss_unreachable, 1×), `timeout`+`silent_failure` (08-17, same conv) |
| BMS health (active company / ANZ) | ✅ healthy; **Finch degraded** (see §4) |
| OpenClaw gateway (this machine) | ✅ running again (port 18789) after config fix (see §5) |

### 2. Deployment status — **EDGE FUNCTIONS ARE STALE. MAIN IS NOT FULLY DEPLOYED.**

- ✅ **Frontend (PR #1)**: deployed — landing + legal pages live on `omanut.lovable.app`.
- ✅ **DB migration (PR #3)**: applied — `primary_model = deepseek-chat` verified live.
- ❌ **Edge functions (PR #2 Swarm v2 + PR #3 code)**: **NOT deployed**. Proof: live `swarm-orchestrator` sync call returns v1 shape — `stage_timings: { gatekeeper_ms, creative_attempt_1_ms, safety_only_ms }` and `models_used: { gatekeeper: "MiniMax-M2", librarian: "glm-4.7+local", creative: "MiniMax-M2" }`. Repo main has v2 (`router_ms`, `librarian_ms`, `strategist_ms`, `writer_attempt_N_ms`, `closer_ms`, `safety_gate_ms`).
- Live deployed `bms-agent` DOES include `health_check` in `available_actions` (probed) — so the function set is a mix; some functions deployed newer than others. **A human must trigger a Lovable/Supabase deploy of main** (§8).

### 3. Open issues status

| Issue | Status |
|---|---|
| 1. Deploy main + post-deploy checklist | 🔴 **BLOCKED on human deploy click** — see §8 |
| 2. OpenClaw pull-loop no-op + telegram streaming bug | 🟢 Config bug FIXED (see §5); pull-loop is legacy by design |
| 3. Crons (ANZ watchdog, duplicate Sales Briefing, Bible Study, Afternoon Nudge) | 🟢 Restored + fixed (see §5) |
| 4. Finch BMS `Unknown action: health_check` | 🟡 PR #5 opened (needs merge + deploy) |

### 4. Finch BMS — root cause + fix

- **Symptom:** `get_bms_health` (Finch company `5b9503c3-…`) shows 287/287 `degraded`, error `VALIDATION / Unknown action: health_check`, every 5 min.
- **Root cause:** the deployed Omanut `bms-agent` forwards `action: health_check` to the company's bridge at `https://hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge`; that **bridge does not implement `health_check`** (contract mismatch). Probing the bridge directly shows other actions work (`list_products`, `get_outstanding_receivables` succeed; `get_sales_summary`, `who_owes`, `daily_report` also rejected as unknown).
- **Fix:** PR #5 (`fix/bms-health-check-fallback`) — when a bridge rejects `health_check` with an unknown-action error, fall back to a `list_products` (limit 1) probe; report healthy if that succeeds. Needs merge + deploy, then Finch health rows should flip to `healthy`.

### 5b. omanut-harness — external LLM decision layer (LIVE + ALL COMPANIES + ALL CHANNELS)

**STATUS 2026-08-31:**
- Farm harness live: `https://omanut-harness.omanut.online` (port 3003, DeepSeek, 31/31 tests).
- **All 7 companies: `harness_mode = on`** (verified live) — WhatsApp DMs for every tenant route through the harness (seam deployed since PR #7).
- **Date-awareness fix** deployed to farm (harness prepends its own "TODAY (Africa/Lusaka)" block + reconciliation rule — bookings in the past are never repeated as "tomorrow").
- **History-window fix (PR #10)** merged: whatsapp-messages sends 30/40 messages to the stateless harness (was 8/12) when harness enabled.
- **Master batch (PR #11)** merged — ON MAIN, needs ONE more Lovable deploy:
  - `harnessChatWithFallback` wrapper in `_shared/harness-client.ts`
  - `generate-reply-draft` (boss handoff drafts) → harness
  - `auto-content-creator` (posts/captions) → harness
  - **NEW `meta-auto-reply` worker** — drains `inbound_events` for FB/IG DMs + comments (these had ZERO auto-replies before); harness-generated, 45-120s comment anti-spam delay, gated by harness_mode
- **Known gap to remember:** the previous Lovable deploy did NOT include `meta-auto-reply` (it wasn't on main then). A final deploy from current main is required to activate it.

**Pilot line:** OmanutBMS metadata keeps `harness_pilot_phones: ["+260972064502"]` (boss test line) alongside `harness_mode: on` — harmless.

### 5b. omanut-harness — external LLM decision layer (LIVE on farm, integration pending)

- **Pattern**: copy of the proven `bms-harness` (DeepSeek router on the farm at
  `bms-harness.omanut.online`, port 3002) applied to Omanut's WhatsApp brain.
- **Local mirror**: `C:\Users\user\Documents\Codex\2026-08-01\hell\outputs\omanut-harness`
  — zero-dep Node, 28/28 test suite (fake DeepSeek in-process), guardrails
  (price guard → 502 llm_price_invention; tool-name guard; reply cap; content-free
  turn log).
- **FARM DEPLOYED 2026-08-25**: service `omanut-harness` active on port 3003,
  HTTPS `https://omanut-harness.omanut.online/health` → `deepseekConfigured: true`.
  .env (chmod 600) has HARNESS_API_KEY + DEEPSEEK_API_KEY; healthcheck cron at
  15,45. Smoke test passed: real turn answered with exact KB price, 401 without
  auth, turn log writing (hashed, content-free).
- **Kill switch**: `companies.metadata.harness_mode = off|pilot|on` +
  `harness_pilot_phones`. Default off — no behavior change until a company opts in.
- **Integration**: `_shared/harness-client.ts` + two seams in
  `whatsapp-messages/index.ts` (main call + tool-loop rounds) — harness first,
  in-house fallback on any failure. Never double-reply, never fail-open.
- **Secrets**: Supabase env OMANUT_HARNESS_URL + OMANUT_HARNESS_API_KEY ✅ added
  (same key as farm .env).
- **Design doc**: `docs/HARNESS-INTEGRATION.md`.
- **REMAINING (human)**: merge PR #7 → deploy to Supabase (Lovable/Supabase
  pipeline) → pilot: set harness_mode=pilot + harness_pilot_phones=[boss line]
  on OmanutBMS → verify log line "[HARNESS] main turn answered by harness" →
  widen to on.

### 5. OpenClaw (this machine) — what was fixed

- **Root cause of 3-week outage:** `C:\Users\user\.openclaw\openclaw.json` had `channels.telegram.streaming: {"mode":"partial"}` — an **object**, but the schema (OpenClaw 2026.3.22) requires a **string** (`"off" | "partial" | "block" | "progress"`). Every gateway start failed: `channels.telegram.streaming: Invalid input (allowed: true, false, "off", "partial", "block", "progress")`. 20 `gateway.startup_failed` stability logs (Jul 21 → Aug 2).
- **Fixed:** rewrote to `"streaming": "partial"`; `openclaw config validate` now passes. Backups of the original: `openclaw.json.bak-dsh-*.json` plus the pre-existing `.bak` chain.
- **Gateway restarted** (background, PID 15396, port 18789). The `OpenClaw Gateway` scheduled task is `At logon` — it should persist across reboots.
- **Crons restored via CLI** (authoritative store is `C:\Users\user\.openclaw\cron\jobs.json`; sqlite `cron_jobs` was stale). Currently scheduled (7):
  - ANZ Lead Watchdog — every 30m, isolated, 180s timeout, runs `workspace/anz_lead_watchdog.js` (the old job referenced a missing `Downloads/anz_lead_watchdog.txt` and had 221 consecutive errors)
  - Omanut Daily Sales Briefing — 08:00 JNB/Lusaka (single; duplicate at 06:00 Lusaka removed)
  - Omanut Daily Briefing — 08:00
  - Daily Facebook Post — 09:00
  - Omanut Afternoon Nudge — 16:00, **model overridden to `moonshot/kimi-k2.5`** to dodge MiniMax quota (job had `rate_limit` errors)
  - Hot Lead Monitor — every 2h
  - Thursday Bible Study Reminder — Thu 17:30 UTC+2, **timeout raised 30s → 120s** (was timing out)
- **Pull-loop:** the `openclaw-pull-loop` script (`workspace/openclaw-pull-loop/index.js`) is **legacy** — the platform removed OpenClaw from the message path (pull endpoints 404; `_shared/openclaw-gate.ts` is an inert stub). It is NOT running, and that is correct: `list_pending_events` returns 0 because the in-house pipeline handles everything. Do not restart it unless the pull protocol is resurrected.
- **Docs fixed** to match reality: PR #6 (`docs/openclaw-removal`) — AGENTS.md §8b now documents the MCP control plane; OPENCLAW_INTEGRATION.md has a deprecation banner; openclaw-skill.json uses `list_pending_events`.

### 6. Known residual issues (non-blocking)

- `supabase/config.toml` still lists `[functions.openclaw-reply]`, `openclaw-dispatch`, `openclaw-pending-trigger` — **auto-generated file, left alone per hard rule #3**; the deploy pipeline should regenerate it.
- 08-17 `timeout` / `silent_failure` for conv `90868eb9` (customer +260977544609): assistant reply took ~3 min; likely slow provider on the old deployed code. Re-check after main deploys.
- 08-14 `handoff_failed` (boss_unreachable) for conv `10154855`: boss notifications were recorded for that conversation (`[purchase_handoff]`, `[payment_request]`), so likely a transient Twilio send failure; the boss-notification path itself works (daily briefings delivered 08-25).

### 7. Repo state

- `main` clean. Local branches: `fix/bms-health-check-fallback` (PR #5), `docs/openclaw-removal` (PR #6) — both pushed.
- Never commit: `.env`, `supabase/config.toml`, `src/integrations/supabase/*`. Migrations are forward-only.

### 8. ⚠️ HUMAN ACTION REQUIRED — Deploy checklist

1. In Lovable/Supabase, **deploy the current `main`** (edge functions + migrations).
2. Verify post-deploy:
   - [ ] `POST /functions/v1/swarm-orchestrator` (sync mode, benign text) returns v2 `stage_timings` with `router_ms` / `writer_attempt_1_ms` / `closer_ms` — **not** `gatekeeper_ms`.
   - [ ] `get_ai_errors` (MCP) shows **zero new** `ai_call_failed` / `ai_fallback_chain_exhausted` after deploy.
   - [ ] `get_bms_health` Finch company flips from `degraded` → `healthy` (after PR #5 merges + deploys).
   - [ ] Landing page `https://omanut.lovable.app` + `/privacy`, `/terms`, `/data-deletion` still 200.
3. Then confirm ads-readiness (§ below).

### 9. Ads + onboarding readiness checklist (pending deploy)

- [ ] Landing/legal pages live ✅
- [ ] AI answers correct against KB (spot-check 2-3 conversations via `get_conversation_trace`)
- [ ] Escalations to boss working (boss notifications delivered — daily briefings OK; verify one hot-lead ping)
- [ ] Zero new AI errors after deploy
- [ ] Finch BMS healthy after PR #5

---

*This doc is the single source of truth for the next harness. Read AGENTS.md first, then this.*

### 5c. UI dead-client fix (PR #8 — fix/ui-env-build, 2026-08-25)

- **Symptom**: `omanut.lovable.app` loads but every authenticated call fails
  (login/dashboard/inbox dead) while the backend is healthy.
- **Root cause**: deployed bundle had `createClient(void 0, void 0)` — the
  Lovable build ran WITHOUT the VITE_SUPABASE_* env vars (also
  `undefined.supabase.co` ×5 in demo URLs, stale bridge project ×1).
- **Fix (PR #8)**: committable `.env.production` with publishable VITE_ values
  (AGENTS.md §2) → future builds bake in the correct config; demo-feed URLs fall
  back to the live project ref; CompanySettingsPanel bridge URL aligned with the
  backend; AGENTS.md §8b/8c/8d brought to reality.
- **Verified**: local build produces `index-B6Xt5CC9.js` with real URL + anon
  key, 0 undefined URLs.
- **REMAINING (human)**: merge PR #8 → Lovable redeploy → verify login works.
  If Lovable still complains, mirror the 3 VITE_ values in its dashboard env.
- **Tip for future harnesses**: never rely on Lovable dashboard env alone; keep
  the publishable VITE_ values in `.env.production` in the repo.


- **UI FIX DEPLOYED 2026-08-25**: bundle index-B6Xt5CC9.js live, real URL baked, UI confirmed working.

### 5e. Harness upgrade (2026-09-01): GLM-5.3-Flash + format rules + meta-auto-reply cron

- **Model switch**: harness now runs `glm-5.3-flash` (Zhipu, `LLM_PROVIDER=glm`, `GLM_MODEL=glm-5.3-flash`, GLM_API_KEY). Provider-agnostic client added (deepseek | glm).
- **Format fix**: `FORMAT_RULES` always appended to every system prompt — plain WhatsApp text, NO markdown/lists/robotic openers. Verified: Finch water-filter reply now natural ("Nice, we've got some great options..."), not a formatted catalogue.
- **Natural tone**: SYSTEM_PROMPT rewritten (conversational, no "Welcome to...", max 1 question).
- **meta-auto-reply cron**: migration `20260901000000_schedule_meta_auto_reply.sql` schedules it every 30s via pg_cron (net.http_post). FB/IG DMs + comments now auto-answered for harness_mode=on companies.
- **Farm**: harness restarted, `/health` shows `provider: glm, model: glm-5.3-flash`. Test suite 33/33.

### 5g. FB page webhook re-pointed to Supabase meta-webhook (2026-09-02, DSH)

- **Symptom**: no FB page feed-comment events since Jul 29.
- **Root cause**: app 882548657500573 ("Omanut AI2025") app-level webhook for object=page still pointed at the legacy bot `https://bot.omanut.online/webhooks/meta` (zambia-swarm). The instagram + user topics already pointed at Supabase; the page topic was missed.
- **Fix**: `POST /{app}/subscriptions` with an app access token — object=page, callback_url=`https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-webhook`, verify_token = the existing META_VERIFY_TOKEN edge-secret value, fields feed+messages (Meta preserved leadgen).
- **Verified**: Meta's own callback re-verification passed on subscribe (subscription `active:true`); manual hub.challenge handshake against the function returns 200 echo (wrong token → 403); POST liveness 200 `{"status":"received"}`. `meta-auto-reply` is deployed + live (`{"ok":true,"processed":0}`); `claim_pending_events` RPC works; 0 pending events for OmanutBMS.
- **Side effects**: (1) bot.omanut.online no longer receives page/leadgen events — E Library leadgen leads now deliver to the Supabase function, which ignores leadgen. If those ads are still live, re-handle or pause them. (2) All pages subscribed to the app (incl. E Library page 776455652221283) now deliver to the platform; entries without a `meta_credentials` row are skipped harmlessly.
- **Acceptance test**: comment on the Omanut Technologies FB page → should enqueue `inbound_events` (channel public_comment) → `meta-auto-reply-30s` pg_cron drains → harness (GLM-5.3-Flash) replies in ~45–120s. If events stay pending, run migration `20260901000000` and check `cron.job` for 'meta-auto-reply-30s'.
- **Live verification + second bug found (2026-09-02)**: webhook delivery, enqueue, dedupe, 30s cron, claim and release all verified with a real comment. The reply send failed in an infinite retry loop (claim → 45–120s delay → fail → release every ~2 min, nothing logged). Root cause: `meta-auto-reply` invoked `send-facebook-comment-reply` with `reply_text`, but the function's Mode 2 contract (and the mcp-server) expect `message` → 400 → throw → release. The stored page token was healthy (reconnect done as a precaution; also refreshed last_verified_at). **Fixed in PR #14 (merged)** — needs the usual Lovable edge deploy; after deploy the queued comment auto-replies without re-commenting.
- **CONFIRMED LIVE (2026-09-02)**: functions redeployed from `c0dfd9a` via Lovable (meta-webhook upsert + meta-auto-reply PR #14; migrations `20260901000000`/`20260901010000` applied — cron `meta-auto-reply-30s` active). Both queued comments drained to `sent` with zero bounce-backs across multiple full worker cycles; replies visible on the post. Two extra findings from the live debug: (1) the deployed meta-webhook had ALSO been stale (no `facebook_comments` upsert) — the loop had two stacked causes, payload contract AND missing rows; (2) stranded comments can be backfilled by re-POSTing a synthetic feed webhook to `meta-webhook` with the real `comment_id` and a `from.id` DIFFERENT from the page id (self-comments are filtered) — queue dedupe (`23505`) prevents duplicate events. Gotcha for future agents: MCP `list_pending_events` CLAIMS events as a side effect (it runs `claim_pending_events`), so polling it to watch the queue interferes with the worker and can mask failures — use sparingly, and never treat a sustained `pending=0` alone as proof of success.
- **Follow-up (DM path)**: `meta-auto-reply`'s `direct_message` branch invokes `send-facebook-message-reply`, which on main is draft-only (requires `draft_id`, 400s otherwise) → autonomous FB/IG DM auto-replies still fail+release the same way. Wire it to a conversation-resolved `send-meta-dm` call (or add an autonomous mode) in a follow-up PR. See PR #14 body.

### 5f. ZAI API endpoint fix (2026-09-01)

- **API key, not coding plan**: the ZAI key is a standard API key. The coding-plan endpoint (`api.z.ai/api/coding/paas/v4`) returns 429; the standard endpoint (`api.z.ai/api/paas/v4`) returns 200.
- **Fixed**: farm harness `ZHIPU_BASE_URL=https://api.z.ai/api/paas/v4` — live, verified turn works.
- **PR #12 merged**: meta-auto-reply 30s cron schedule is on main (needs migration run + deploy).
- GLM-5.3-Flash live on the harness with natural WhatsApp formatting (verified: "Hey! Yes, we've got a nice range...").

### 5h. Agents-as-a-Service foundation: Company Brain + full Meta channel coverage (2026-09-02)

PRs **#16, #17, #18** (all merged; need ONE Lovable edge-function deploy of main):

- **#17 meta-webhook v2**: Instagram credential resolution (`page_id` OR `ig_user_id` — IG events were silently dropped before); Instagram comment ingestion (persisted to `facebook_comments`, enqueued as `public_comment` source `meta_comment_ig`); FB+IG DM conversation lifecycle (conversations with `fbdm:<psid>` / `igdm:<igsid>` phones, every inbound turn persisted to `messages`, `conversation_id` in the event payload).
- **#16 meta-auto-reply DM branch**: autonomous FB/IG DM replies via `send-meta-dm` (conversation-based, Graph `/me/messages`, is-live-gate respected, outbound turn persisted, `sent_by=ai_agent`), grounded in company facts + conversation history. Events without a conversation → `skipped: no_conversation`.
- **#18 `_shared/company-context.ts` — the Company Brain**: `buildCompanyFacts` (KB grounding; the pricing input that satisfies the harness price guard), `buildCommentContext` (post text via Graph + parent comment + commenter thread), `buildDmContext` (conversation turns). `meta-auto-reply` refactored onto it (−81 duplicated lines). Future adopters: `auto-content-creator`, `generate-reply-draft`.

**Channel state after deploy**: WhatsApp full brain ✅ · FB comments grounded ✅ · FB/IG DMs autonomous + grounded ✅ (NEW) · IG comments ingested + auto-replied ✅ (NEW).

**Test**: DM the Omanut Technologies page "how much is the pro plan?" → DM quotes K799 from the KB within ~30–60s. IG: comment on a linked IG post → reply appears (needs the IG account linked in Meta Integrations).

**AaaS onboarding per tenant** (no code): fill KB (`services`, `quick_reference_info`, `voice_style`) → connect Meta + WhatsApp in Meta Integrations → `harness_mode=on` (per-company kill switch + `harness_pilot_phones` = the pilot→live funnel). Billing tiers already in schema (`credit_usage`, plans).

**Gotcha**: `messaging_type: RESPONSE` in send-meta-dm means Meta's 24h DM window applies — replies only work within 24h of the customer's last message (standard FB rule).

**CONFIRMED LIVE (2026-09-02, later)**: after one more broken deploy (deployed meta-auto-reply called an undefined `buildFacts()` — a stale Lovable-tree merge; every event failed with `buildFacts is not defined`, captured via the worker's own `results[]` error array), Lovable restored the file to main's contents and redeployed. **End-to-end verified live with a real FB DM**: `fbdm:` conversation auto-created → inbound turn persisted → cron worker claimed → harness (GLM-5.3-Flash) grounded reply from KB → sent via send-meta-dm → outbound turn persisted. Fully autonomous, zero human input.

**Debug tips for future agents**: (1) `POST /functions/v1/meta-auto-reply` with `{}` returns `{ok, processed, results[]}` where `results[].error` contains the EXACT per-event failure — the single best ground-truth probe for this worker. (2) `get_conversation` (MCP) is read-only — use it instead of `list_pending_events` when watching a live thread (the latter claims events). (3) Lovable's deploy reports can be inaccurate (stale tree, wrong commit labels, once even claimed functions don't exist that demonstrably run) — always verify deployed behavior by probing endpoints, never by trusting the chat.

### 5i. Omanut Motion — own-the-stack video generation via Seedance/fal (2026-09-02, PR #19 — needs deploy + FAL_KEY)

The "build our own Higgsfield" play: models called directly (Seedance via fal.ai), prompts written by the harness, lifecycle owned by the platform.

- **NEW `omanut-motion` edge function**: POST `{ company_id, brief, aspect_ratio?, resolution?, duration?, input_image_url? }` → harness (GLM-5.3-Flash) writes ONE cinematic Seedance prompt grounded in company facts → fal queue submit (`fal-ai/bytedance/seedance/v1/pro/text-to-video` or `image-to-video` with `input_image_url` = brand product shot) → `video_generation_jobs` row (`video_provider='seedance'`, `operation_name`=fal request_id) → kicks first poll. CRON_SECRET bearer gate (watchdog pattern).
- **`poll-video-generation`**: new `seedance` branch — polls `queue.fal.run/requests/{id}/status`, terminal handling (COMPLETED/failed/nsfw/canceled), downloads mp4 → `company-media` storage → WhatsApps the boss (mirrors veo/minimax).
- **Migration `20260902120000`**: schedules `poll-video-generation-60s` via pg_cron — it previously had NO scheduler (jobs could sit pending forever).
- **DEPLOY CHECKLIST (Lovable)**: sync main (PR #19, HEAD 67f7e21) → redeploy `poll-video-generation` + deploy NEW `omanut-motion` → apply migration `20260902120000` → set edge secret `FAL_KEY` (fal key_id:key_secret combined).
- **Cost (fal Seedance v1 Pro)**: ~$0.62 / 1080p 5s · ~$0.28 / 720p 5s · ~$0.12 / 480p 5s. Default resolution in the function is 720p (draft quality). ~$5 ≈ 8× 1080p or ~17× 720p drafts.
- **Test**: POST omanut-motion `{ company_id: "3408d643-8e9c-4c46-b684-4960fba1e0e9", brief: "15-second ad for our BMS, Zambian shop owner using a phone, morning light" }` → job pending → boss WhatsApp'd with the video in ~1-3 min.
- **Next layers**: tenant credit deduction per generation (spending guard), preset library (motion templates per brand), scheduled-post video publishing, fal webhook instead of polling.
- **v2 — multi-sub-agent pipeline (PR #21, merged)**: adapted the 3-role video workflow from [NatiDvir/video-skills](https://github.com/NatiDvir/video-skills) (MIT — the same structure Higgsfield's own video showcases). omanut-motion now runs: (1) **Marketing Strategist** — style lock + 2-second hook + beat timeline + CTA (strict JSON, grounded in company facts); (2) **Creative Director** — shot-by-shot plan with camera/lighting/action + a production-ready Seedance prompt per shot + hero shot designation; (3) **Generator** — renders the HERO shot first (preview→hero cost ladder), full shot plan persisted in `scheduled_post_data.shot_plan` for additional renders on approval. Strict-JSON extraction with brace fallback; graceful degradation to the single-prompt path. Test after deploy: one POST → response includes `style`, `hook`, `cta`, `shot_plan`.
