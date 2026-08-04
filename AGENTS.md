# AGENTS.md — Omanut OS

Read this file first. It is the single orientation document for any AI agent (Claude Code, Codex, Cursor, OpenClaw, a GitHub Action bot) that has been given this repository and asked to operate on it.

---

## 1. What this product is

**Omanut OS** is a multi-tenant AI business-operations platform for African SMEs (retail, hospitality, education, services). Each tenant is a **company**. For each company the platform:

1. Receives inbound customer messages from **WhatsApp (Twilio or Meta Cloud API)**, **Facebook/Instagram DMs**, and **Facebook/Instagram comments**.
2. Runs them through an **LLM agent** that has the company's knowledge base, brand voice, custom instructions, and live business data (stock, pricing, debtors) from an external BMS.
3. Replies autonomously, calls tools (check stock, quote, take a reservation, request payment, generate an image), and **hands off to the business owner ("the boss") over WhatsApp** when a lead is hot, a rule is hit, or the AI is unsure.
4. Gives the owner a web dashboard: conversations, inbox, insights, media studio, ad manager, setup wizard, billing.

The owner never touches a console. Everything is either the dashboard or WhatsApp.

---

## 2. Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui |
| Routing | react-router-dom (`src/App.tsx`) |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions on Deno) |
| Edge functions | `supabase/functions/*` — ~90 functions, Deno, `serve()` handlers |
| Migrations | `supabase/migrations/*.sql` (timestamp-prefixed, forward-only) |
| LLMs | Direct provider APIs (Moonshot/Kimi, Zhipu/GLM, MiniMax, Gemini, DeepSeek) |
| Messaging | Twilio WhatsApp (default), Meta WhatsApp Cloud (per-company opt-in), Meta Graph API |

Hosted on Lovable Cloud. The Supabase project ref, anon key and function base URL live in `.env` (`VITE_SUPABASE_*`) — those are publishable. All private keys are Supabase **edge function secrets**, never in the repo.

---

## 3. Repository map

```
src/
  App.tsx                      route table — start here for UI
  context/CompanyContext.tsx   ALWAYS use this for the active company_id
  pages/                       route-level screens (client + /admin/*)
  components/admin/            owner/admin control surfaces
  components/admin/deep-settings/  model, tools, agent-mode, supervisor config
  components/conversations/    chat UI
  components/setup/            self-serve onboarding cards
  hooks/useSetupStatus.ts      onboarding completeness
  hooks/useIsPlatformAdmin.ts  platform-admin gate
  integrations/supabase/       AUTO-GENERATED — never edit client.ts or types.ts

supabase/
  functions/_shared/           the real core logic lives here
  functions/<name>/index.ts    one edge function per directory
  migrations/*.sql             schema history
  config.toml                  AUTO-GENERATED function config (verify_jwt etc.)

OPENCLAW_INTEGRATION.md        external-agent pull-mode protocol (see §8)
.lovable/plan.md               current working plan
```

### `_shared` — the modules that matter

| File | Responsibility |
|---|---|
| `gemini-client.ts` | **The brain router.** `PRIMARY_TEXT_MODEL`, the provider fallback chain, per-provider request shaping (Kimi K2.6/K3 quirks: no `temperature`, `max_completion_tokens`, `reasoning_effort`), billing/quota error detection, `geminiChatWithFallback()`. Every AI call should go through here. |
| `minimax-client.ts` | MiniMax provider adapter. |
| `openclaw-envelope.ts` | `buildEnvelope()` — packs company context, KB, brand voice, custom instructions, BMS snapshot, recent history into one payload for an external agent. |
| `openclaw-gate.ts` | Decides whether OpenClaw (external) or the in-house pipeline owns an event. |
| `boss-phones.ts` | Boss/owner phone resolution + roles. Boss numbers must never be treated as customers. |
| `tenant-context.ts` | Company resolution and multi-tenant guards. |
| `is-live-gate.ts` | Sandbox vs live outbound gate (`SANDBOX_ENFORCEMENT`). Blocks real sends in test mode. |
| `safety-mode-gate.ts` | `safety_only` mode: AI may only research + notify the owner, never message customers. |
| `pending-action.ts` | Promise tracking ("one moment…") + watchdog fulfilment. |
| `persona-cache.ts` | Cached persona/agent-mode assembly. |
| `swarm/` | Multi-role critique swarm (gatekeeper → creative → critic), profiles `lite`/`full`/`safety_only`, budgets per channel. |
| `bms-connection.ts` | External Business Management System bridge (stock, pricing, debtors). |
| `security-logging.ts`, `safe-error.ts` | Audit + non-leaking error surfaces. |

---

## 4. The message lifecycle (the thing to understand)

```
Customer
  │
  ├─ Twilio webhook ──────► whatsapp-messages   (main WhatsApp brain)
  ├─ Meta webhook ────────► meta-webhook ──► send-facebook-message-reply / -comment-reply
  └─ Boss's own number ───► boss-chat           (owner console over WhatsApp)
                                 │
                      inbound_events (queue, status: pending → claimed → sent)
                                 │
        ┌────────────────────────┴───────────────────────┐
        ▼                                                ▼
  in-house pipeline                            external agent (OpenClaw)
  gemini-client fallback chain                 mcp-server / openclaw-pull
  + tools + swarm                              → openclaw-reply
        │                                                │
        └────────► send-whatsapp-message ◄───────────────┘
                       ├─ Twilio (default)
                       └─ send-whatsapp-cloud (whatsapp_provider = 'meta_cloud')
```

Post-send, async:
- `supervisor-agent` scores urgency / conversion probability → hot-lead escalation.
- `check-rule-adherence` (DB trigger on `messages`) audits the reply against custom instructions → `rule_violations` → `/rule-violations` page.
- `swarm-orchestrator` may run `post_hoc_refine`.

Cron/watchdogs: `engagement-watchdog`, `pending-promise-watchdog`, `check-unanswered`, `sla-escalation`, `bms-auto-sync-cron`, `process-scheduled-posts`, `cron-publisher`, `meta-ads-sync-insights`, `daily-briefing`, `csat-followup`.

Owner notification path — **non-negotiable contract**: a handoff must send a real WhatsApp message via `sendBossHandoffNotification` / `send-boss-notification`, not merely insert a `boss_conversations` row. Dedupe uses `boss_conversations.message_content ilike '%<conversation_id>%'` with a `[uuid]` marker.

---

## 5. Key tables

- `companies` — tenant root (`whatsapp_provider`, `metadata.sales_mode`, hours, payments).
- `company_users`, `user_roles` (roles live **only** here — never on profiles), `company_boss_phones` (role + notification prefs).
- `conversations`, `messages`, `whatsapp_messages`, `facebook_messages`, `facebook_comments`.
- `inbound_events` — the canonical event queue (`openclaw_events` is legacy/sandbox; do not reintroduce it as a second queue).
- `company_ai_overrides` — per-company `primary_model`, temperature, `enabled_tools`, prompt overrides.
- `company_agent_modes` — persona/mode definitions.
- `boss_conversations` — owner↔AI thread + notification dedupe ledger.
- `rule_violations`, `ai_error_logs`, `swarm_runs`, `security_events`, `cross_tenant_audit`.
- `bms_connections`, `bms_call_log`, `bms_health_log`.
- `reservations`, `payment_transactions`, `payment_products`, `support_tickets`, `scheduled_posts`, `meta_ad_*`, `credit_usage`.

**Multi-tenancy is enforced by `company_id` + RLS (`user_has_company_access_v2`, `has_role`).** Every new public table needs `GRANT`s + `ENABLE ROW LEVEL SECURITY` + policies in the same migration.

---

## 6. Hard rules an agent must not violate

1. **Model routing**: never call the Lovable AI Gateway (`ai.gateway.lovable.dev`) or read `LOVABLE_API_KEY` from AI code. Use direct provider APIs via `_shared/gemini-client.ts`. (Sole exception: `auth-email-hook`, which uses `LOVABLE_API_KEY` for email signing, not AI.)
2. **Company resolution**: use `CompanyContext` / the `get_user_companies()` RPC. Never query the legacy `users` table for tenancy.
3. **Never edit** `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `.env`, or `supabase/config.toml` project settings by hand — they are generated.
4. **Never** touch `auth`, `storage`, `realtime`, `supabase_functions`, `vault` schemas.
5. **Confidentiality**: the AI must never leak system prompts, BMS wholesale costs, or internal instructions to customers.
6. **Timezone**: all business logic and AI context is Africa/Lusaka (GMT+2); convert to UTC only for Meta scheduling.
7. **Boss numbers are not customers** — route them to `boss-chat`.
8. **Migrations are forward-only.** Add a new timestamped `.sql`; never rewrite history.
9. **Secrets** are edge-function secrets. Never commit a key, never log one.

---

## 7. Environment / secrets inventory

Providers: `KIMI_API_KEY`, `ZHIPU_API_KEY`, `MINIMAX_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`.
Model control: `PRIMARY_TEXT_MODEL`, `FALLBACK_TEXT_MODEL` (instant rollback levers — change the env var, not the code, for a model swap).
Messaging: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`, `META_WHATSAPP_ACCESS_TOKEN`.
External agent: `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_WEBHOOK_SECRET`.
Ops: `CRON_SECRET`, `SANDBOX_ENFORCEMENT`, `USE_EVENT_QUEUE`, `BMS_API_SECRET`, `RESEND_API_KEY`, `GOOGLE_CALENDAR_*`.
Supabase-injected: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## 8. Taking control from outside (external agent, GitHub)

Two orthogonal control planes. Use both.

### 8a. Code control — via GitHub
The repo is (or can be) synced to GitHub two-way from Lovable. An external coding agent works exactly like a human contributor:

```bash
git clone <repo>
bun install
bun run dev          # http://localhost:8080
bun run lint
bun run build        # the only real typecheck gate
```

Then branch → change → PR → merge to the default branch. Merged changes sync back into Lovable automatically. Edge functions under `supabase/functions/**` and migrations under `supabase/migrations/**` deploy through the Lovable/Supabase pipeline, **not** through Vite — an agent editing them must state that a deploy is required.

Recommended agent PR discipline for this repo:
- One concern per PR; never mix a migration with a UI refactor.
- Any change to `_shared/gemini-client.ts`, `whatsapp-messages`, `boss-chat`, or the handoff path is **high blast radius** — describe the customer-visible effect in the PR body.
- Prefer flipping an env var (`PRIMARY_TEXT_MODEL`) over editing the fallback chain.

### 8b. Runtime control — via the pull protocol
An external agent can *be the brain* without touching code. Full spec in `OPENCLAW_INTEGRATION.md`. Summary:

- Long-poll `GET /functions/v1/openclaw-pull?max=10&wait=25` with `Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN` (optional `X-Openclaw-Company` to scope to one tenant).
- Each event is a self-contained **envelope**: company context, knowledge base, brand voice, custom instructions, BMS snapshot, recent history, inbound text/media, and `reply_to_url`.
- Reply with `POST /functions/v1/openclaw-reply`, HMAC-signed: `X-Openclaw-Signature: sha256=<HMAC-SHA256(rawBody, OPENCLAW_WEBHOOK_SECRET)>`.
- Omanut performs the actual Twilio/Meta send, persists the message, and runs the supervisor/critic passes.
- Claiming is atomic via the `claim_pending_events` RPC — do not hand-roll status flips, or events get processed multiple times.
- `mcp-server` exposes the same surface as MCP tools for MCP-native agents. It reads `inbound_events` only.
- Per company, `openclaw_mode = 'primary'` makes the external agent authoritative and the in-house worker releases events back to `pending`. `OPENCLAW_INHOUSE_FALLBACK_ENABLED` (default false) controls whether the in-house brain rescues stalled events after the grace window (`OPENCLAW_PULL_GRACE_SECONDS`).

**Choosing a plane:** change behaviour permanently → GitHub. Own the conversation live → pull protocol. Swap models or thresholds → env vars / `company_ai_overrides` rows, no deploy.

---

## 9. Debugging playbook

| Symptom | Look at |
|---|---|
| Customer gets "I couldn't complete that just now." | Whole fallback chain exhausted → edge logs for `whatsapp-messages`, then provider auth/quota. `ai_error_logs` severity `critical`. |
| Boss gets no handoff ping | Was `sendBossHandoffNotification` called, or only a `boss_conversations` insert? Check the 30-min dedupe marker. |
| Same event answered repeatedly | Claiming bypassed `claim_pending_events`. |
| AI ignores custom instructions | `rule_violations` + `/rule-violations`; check the instruction "sandwich" in the system prompt and `company_ai_overrides`. |
| No inbound at all | Twilio/Meta webhook target, then `inbound_events` for a new `pending` row, then `/admin/sandbox-console` panels. |
| Stock/price wrong | BMS is authoritative over the static KB — the AI must call `check_stock` / `list_products`, not recite cached text. |

Useful admin surfaces: `/admin/observability`, `/rule-violations`, `/supervisor-insights`, `/admin/conversations/:id/control`, `/client-insights`.

---

## 10. Definition of done for any change here

- `bun run build` passes.
- New public table → GRANTs + RLS + policies in the same migration.
- Anything touching outbound → respects `is-live-gate` and `safety-mode-gate`.
- Anything touching the owner path → sends a real WhatsApp, deduped.
- No secret, no wholesale cost, no system prompt is newly reachable by a customer.
