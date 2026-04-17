

## Verifying OpenClaw's bug claims

I checked the code and DB. Here's what's actually true vs what OpenClaw guessed:

| # | OpenClaw claim | Reality |
|---|---|---|
| 1 | Publish uses deprecated `/me/stories` | **False.** `publish-meta-post/index.ts` already uses `/{page_id}/photos` and the IG two-step container flow. No `/stories` endpoint anywhere in the codebase. |
| 2 | `(#100)` from Meta = Supabase URL unreachable | Bucket `company-media` is **public**. URLs are reachable. (#100) is more likely a **caption/parameter validation** issue or a missing `published` field — not a CDN block. |
| 3 | `business_context` is null → BRAND-ONLY mode | **Partially true.** `business_context` is null for ANZ, but the actual BRAND-ONLY trigger is `allProfiles.length === 0 && !productMatch` in `whatsapp-image-gen`. The good description is sitting in `style_description` instead of `business_context`. Both fields need to be populated. |
| 4 | `publish_facebook_post` / `publish_instagram_post` need `post_id` | **True and worse.** The MCP tools pass `caption`/`image_url`/`platform` to `publish-meta-post`, but that function only accepts `post_id` (a `scheduled_posts` row). The tools are **completely broken** — they always fail. Need to either create a row first then publish, or add ad-hoc publish support. |

## Fix plan

### Bug 4 — make `publish_facebook_post` / `publish_instagram_post` actually work

Two-step inside the MCP tool handler:

1. Insert a row into `scheduled_posts` with `status='approved'`, `scheduled_time=now()`.
2. Call `publish-meta-post` with that `post_id`.
3. Return the Meta post ID + the scheduled_posts row.

Files: `supabase/functions/mcp-server/index.ts` only.

### Bug 3 — backfill `business_context` for ANZ + teach the AI to use both fields

Two parts:

**3a. Data fix (one-time, via `manage-data` insert tool):** Copy the rich `style_description` value into `business_context` for ANZ so `generate-business-image` enhances prompts properly. (Migration tool can't UPDATE — uses insert tool.)

**3b. Code fix in `generate-business-image/index.ts`:** Fall back to `style_description` when `business_context` is null. Keeps prompt enrichment working for any future company that has only one populated.

### Bug 1 — verify, no code change

Add a one-line comment in `publish-meta-post` confirming `/photos` is intentional. No real change needed; OpenClaw was wrong about the deprecated endpoint.

### Bug 2 — better error surfacing

The `(#100)` from Meta is opaque. Update `publish-meta-post` to **log and return the full Meta error payload** (`error.message`, `error.error_subcode`, `error.error_user_msg`, `fbtrace_id`) so we can actually diagnose next time. Currently we drop the subcode and just keep `error.message`, which is why "(#100)" gives no detail.

Files: `supabase/functions/publish-meta-post/index.ts`.

### Files to edit
- `supabase/functions/mcp-server/index.ts` — rewrite `publish_facebook_post` + `publish_instagram_post` handlers to insert-then-publish.
- `supabase/functions/generate-business-image/index.ts` — fall back to `style_description` when `business_context` is null.
- `supabase/functions/publish-meta-post/index.ts` — return full Meta error payload (subcode, user_msg, trace_id) instead of just `.message`.
- Data fix via insert tool: copy `style_description` → `business_context` for ANZ company.

## Verification

After deploy, in OpenClaw:
1. `set_active_company` → ANZ.
2. `generate_business_image { prompt: "promotional poster of a frying pan" }` → uses ANZ products, not generic stock.
3. `publish_facebook_post { caption: "Test", image_url: "<public url>" }` → returns `{ success, meta_post_id, scheduled_post_id }`.
4. If Meta returns (#100) again, the response now includes `error_subcode` and `fbtrace_id` so we can pinpoint the exact validation failure.

