
# Facebook Ads — Campaign Manager (Tier 2)

Owner-only UI inside the admin panel to create, list, pause/resume, and monitor Facebook (and Instagram) ad campaigns through the Meta Marketing API, reusing the brand's existing AI-generated creatives and approved posts.

## What the owner will see

A new **"Ads"** tab on each company workspace with:

1. **Ad Account setup card** — paste the Ad Account ID once per company. A "Verify access" button checks the token actually has `ads_management` + `ads_read` and the account is active and billable. Clear red/green status with the exact missing scope if it fails.
2. **"New Campaign" wizard** (4 steps):
   - **Goal**: Traffic / Messages (WhatsApp/Messenger) / Leads / Engagement / Sales (link clicks to a product)
   - **Creative**: pick from approved scheduled posts, the brand asset library, AI-generated images, or upload new. Headline + primary text + CTA button. Live preview.
   - **Audience**: location (default to company's country), age range, gender, interests (searchable Meta interest picker), or "Lookalike of my customers".
   - **Budget & schedule**: daily or lifetime budget in the company's currency, start date, end date (or ongoing), then a confirmation screen showing total spend cap before launch.
3. **Campaign list** — every campaign with status (Active / Paused / Ended / In review), spend so far, impressions, clicks, CTR, results (messages / leads / purchases), and cost per result. Pause / Resume / Duplicate / End buttons.
4. **Insights drawer** — daily breakdown chart, top-performing creatives, audience age/gender split.

## How it fits with what's already there

- Reuses `meta_credentials` (Page token + new `ad_account_id` field).
- Pulls creatives from existing `scheduled_posts`, `company_media`, and `generated_images`.
- Pause/resume/end actions log to the existing audit pattern.
- Spend metrics show in the Dashboard alongside conversation stats.

## Permissions

Only company role = **owner** can open the Ads tab, launch, pause, or end campaigns. Managers can view read-only insights. Enforced both in UI (route guard) and in the edge functions (server-side role check before any Marketing API call).

## Technical plan

**1. Database (one migration)**
- `ALTER TABLE meta_credentials ADD COLUMN ad_account_id text` (format `act_XXXX`)
- New table `meta_ad_campaigns`: `id, company_id, credential_id, meta_campaign_id, meta_adset_id, meta_ad_id, name, objective, status, daily_budget_cents, lifetime_budget_cents, currency, start_at, end_at, creative_payload jsonb, targeting jsonb, created_by, created_at, updated_at`
- New table `meta_ad_insights_daily`: `id, campaign_id, company_id, date, spend_cents, impressions, reach, clicks, results, cost_per_result, raw jsonb` (one row per campaign per day, upserted by cron)
- RLS: SELECT for any company member, INSERT/UPDATE/DELETE only via security-definer functions called from edge functions (which check `owner` role).

**2. Edge functions**
- `meta-ads-verify` — pings `/me/permissions` + `/{ad_account_id}?fields=account_status,currency,funding_source` and returns a clean status object. Used by the "Verify access" button.
- `meta-ads-launch` — owner-only. Creates Campaign → AdSet → Creative → Ad in Meta, persists IDs to `meta_ad_campaigns`. Validates input with Zod. Handles Meta error codes (`100`, `190`, `200`, `2635`) with human-readable messages.
- `meta-ads-control` — owner-only. Pause / resume / end an existing campaign (updates Meta status + local row).
- `meta-ads-list` — returns campaigns + latest insights for the UI (uses cached `meta_ad_insights_daily`, falls back to live fetch).
- `meta-ads-sync-insights` — cron-triggered every 2h. For every active campaign, fetches `/{campaign_id}/insights` for the last 7 days and upserts into `meta_ad_insights_daily`.
- `meta-ads-targeting-search` — proxy to `/search?type=adinterest` for the interest picker (rate-limited per company).

**3. Cron job**
`pg_cron` schedule running `meta-ads-sync-insights` every 2 hours.

**4. Frontend**
- New tab in `CompanyTabs.tsx` (icon: Megaphone) gated by `useCompanyRole() === 'owner'`.
- Components in `src/components/admin/ads/`: `AdsPanel.tsx`, `AdAccountSetupCard.tsx`, `NewCampaignWizard.tsx` (with `GoalStep`, `CreativeStep`, `AudienceStep`, `BudgetStep`), `CampaignList.tsx`, `CampaignInsightsDrawer.tsx`, `InterestPicker.tsx`.
- React Query for list/insights with realtime invalidation on launch/pause.

**5. Safety rails**
- Hard-cap on daily budget per company (configurable, default 10,000 in company currency) to prevent runaway spend from a typo.
- Confirmation modal showing "You will spend up to X over Y days" before any launch call.
- Every launch/pause/end action writes to a `meta_ad_audit_log` (campaign_id, action, actor user_id, before/after status).

## What this build does NOT include

- Tier 1 (one-click boost button on a single post) — can be added quickly later as a shortcut into the same wizard.
- Tier 3 (WhatsApp AI autopilot for the boss) — separate follow-up.
- Custom audiences from uploaded customer lists, A/B split tests, dynamic product ads from a catalog feed — all possible later, not in this slice.
- Ad payment method management (must be set up in Meta Business Manager by the owner — we surface a clear error if missing).

## Open dependency

If `ads_management` turns out NOT to be on the stored Page token (Page tokens normally don't carry it — you usually need a User token or System User token), we'll need a one-time reconnect flow with the right scopes. The "Verify access" button will tell us this on the first try per company; if it fails I'll add a guided reconnect step before any campaign can be launched.
