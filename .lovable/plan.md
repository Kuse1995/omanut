
# Enterprise SaaS Client Dashboard — Zambia-First UX

## The problem today

The client-facing app is a thin shell. The powerful tools (Facebook/Instagram OAuth, WhatsApp Cloud, payments, BMS, AI training, brand assets, content scheduler) all live under `/admin/*` — only the Omanut internal team can use them. Clients see:

- A Dashboard with stats
- A flat Settings form (long scroll, no grouping, no guidance)
- Conversations / Reservations / Insights (read-only)

Result: every "connect Facebook", "set up payments", "fix the AI prompt" request becomes a manual ticket to us. That doesn't scale, and Zambian SME owners can't self-serve.

## What we're building

A **client-owned Setup & Integrations hub** plus a **friendlier home/onboarding experience** designed for first-time, non-technical Zambian business owners (mostly mobile/tablet, often on slow data, English + occasional Bemba/Nyanja phrasing in copy).

### 1. New route: `/setup` — "Connect Your Business"

A single, guided hub split into clear cards. Each card = one integration with status pill (Connected / Action needed / Not set up), a one-line plain-English description, and an action button.

Cards (reusing existing admin panels, scoped to the client's company via `useCompany`):

```text
┌──────────────────────────────────────────────────────┐
│  Setup & Integrations                                │
├──────────────────────────────────────────────────────┤
│  [✓] WhatsApp           Connected  +260 97 ...      │
│  [✓] Facebook & IG      1 page connected            │
│  [!] Payments           Action needed — add MoMo    │
│  [○] Business System    Not set up — sync catalog   │
│  [✓] AI Personality     Trained                      │
│  [○] Brand Kit          Add logo & colors            │
└──────────────────────────────────────────────────────┘
```

The Facebook/Instagram card embeds the existing `MetaIntegrationsPanel` (one-click FB Login, page picker, WhatsApp Cloud manual fallback). It already works for admins — we just expose it on the client side with the same `selectedCompany` context.

### 2. Redesigned Settings — tabbed, not one giant form

Replace the current 360-line scroll with tabs:
- **Business** (name, type, hours, services, currency, locations)
- **AI Personality** (voice style, banned topics, fallback message — drawn from `company_ai_overrides`)
- **Numbers** (Twilio number, takeover number, WhatsApp Cloud toggle)
- **Calendar & Reservations** (Google Calendar, buffer minutes)
- **Team** (manage company_users — owner/manager/contributor/viewer, invite by email via existing `invite-company-user`)
- **Boss Phones** (already in admin — surface `company_boss_phones` with role + notification toggles)

Each tab has inline helper copy in plain language ("This is the WhatsApp number your customers will message" not "WhatsApp Number").

### 3. Friendlier Dashboard home

Add above the stats:

- **Setup checklist widget** — shows progress (e.g., "4 of 6 connected") with a "Finish setup" CTA that deep-links to `/setup`. Hidden once everything is green.
- **"What your AI did today" digest** — replaces generic stats with a human sentence: *"Your AI handled 23 conversations, booked 4 reservations, and flagged 2 hot leads for you."*
- **Action items inbox** — surfaces `action_items` rows (handoffs, scheduled-post drafts awaiting approval, missed leads) with one-tap Approve/Reply/Dismiss.

### 4. Zambia-first UX polish

- **Currency**: default `K` everywhere, format with thousand separators (e.g. K 1,250).
- **Phone inputs**: auto-prepend `+260` and validate E.164; show example `+260 97 1234567`.
- **Mobile-first**: client sidebar collapses to a bottom-nav on `<768px` (current viewport is 745×528 — sidebar eats too much space). Larger tap targets (min 44px), bigger fonts on small screens.
- **Plain-English copy**: replace jargon ("PSTN", "Twilio", "webhook", "JWT") with "phone line", "WhatsApp provider", "auto-connect".
- **Onboarding tooltip tour** for first login (using a lightweight 3-step popover, not a heavy library).
- **Status language**: "Live" / "Action needed" / "Not connected" — avoid red-only error states (use amber for "needs attention").
- **Bandwidth-aware**: lazy-load heavy panels, skeleton loaders instead of spinners, defer the brand-asset gallery.

### 5. New "Inbox" route — `/inbox`

Single feed combining: handoff requests, content drafts awaiting approval, low-credit warnings, failed posts, hot leads from supervisor. Each item has primary action inline (Approve, Reply, Top Up, Retry). This is what Zambian owners actually want — one screen, one finger.

## Technical notes

**Files to add:**
- `src/pages/Setup.tsx` — new hub page, 6 integration cards
- `src/pages/Inbox.tsx` — unified action items feed
- `src/components/dashboard/SetupChecklist.tsx` — widget on Dashboard
- `src/components/dashboard/AiDigest.tsx` — "what your AI did today" sentence
- `src/components/dashboard/MobileBottomNav.tsx` — mobile nav shown <768px
- `src/components/setup/IntegrationCard.tsx` — reusable status card
- `src/components/setup/PhoneInput.tsx` — +260 auto-prefix + validation
- `src/components/setup/TeamPanel.tsx` — invite & manage company_users
- `src/components/setup/BossPhonesPanel.tsx` — manage company_boss_phones
- `src/pages/Settings.tsx` — refactor into tabbed layout

**Files to refactor (no schema changes):**
- `src/components/admin/MetaIntegrationsPanel.tsx` — extract to `src/components/integrations/MetaIntegrationsPanel.tsx` so both admin and client routes import it; admin keeps the same import path via re-export.
- `src/components/dashboard/ClientSidebar.tsx` — add Setup, Inbox entries; replace legacy `users` query with `useCompany()` (per company-resolution-protocol memory).
- `src/pages/Dashboard.tsx` — same `useCompany()` migration; embed checklist + digest.
- `src/App.tsx` — register `/setup` and `/inbox` routes behind `RequireCompany`.

**Reused existing infra (zero new edge functions needed):**
- `meta-public-config`, `meta-oauth-exchange`, `meta-oauth-connect-pages` (FB OAuth)
- `invite-company-user` (team invites)
- `company_whatsapp_cloud` table + provider toggle
- `company_ai_overrides`, `company_boss_phones`, `action_items` tables
- `MetaIntegrationsPanel`, `PaymentsPanel`, `BmsSyncPanel`, `AITrainingEditor`, `BrandAssetLibrary` (all already built)

**Permissions:** all new client routes wrapped in `RequireCompany`; team management restricted to `owner` / `manager` via `useCompanyRole`.

**No database migrations.** This is purely a client-side surfacing of capabilities that already exist in the backend.

## Out of scope (call out so we agree)

- No new payment provider integration (Paddle/Stripe) — separate decision.
- No localisation framework (i18n). Copy stays English but plain. We can add Bemba/Nyanja strings later if you want.
- No changes to the `/admin/*` panels' internals — only an extract-and-re-export so clients can use them too.

## Rollout

1. Extract MetaIntegrationsPanel + add `/setup` route (biggest win — clients can self-onboard FB/IG today).
2. Refactor Settings into tabs + add PhoneInput / +260 helper.
3. Add Setup Checklist + AI Digest widgets to Dashboard.
4. Add `/inbox` and mobile bottom nav.
5. Polish: empty states, plain-English copy pass, skeleton loaders.

Approve and I'll start with step 1.
