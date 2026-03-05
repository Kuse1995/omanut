

## Fix: Instagram "Media ID is not available" Error

### Root Cause
Instagram's two-step Content Publishing API creates a media container (step 1) that needs processing time before it can be published (step 2). The current code calls `media_publish` immediately after creating the container, but Instagram hasn't finished processing the image yet.

The error from the database confirms this: `"Instagram publish: Media ID is not available"`.

### Solution
Add a polling loop between container creation and publishing in both `publish-meta-post` and `schedule-meta-post`. After creating the container, poll `GET /{container_id}?fields=status_code` until it returns `FINISHED`, then proceed with publishing.

Instagram docs specify the container status can be:
- `IN_PROGRESS` — still processing
- `FINISHED` — ready to publish
- `ERROR` — failed

### Changes

**`supabase/functions/publish-meta-post/index.ts`**
- After the container creation call succeeds, add a polling loop:
  - `GET https://graph.facebook.com/v25.0/{creation_id}?fields=status_code`
  - Retry up to 10 times with 3-second delays (30s max wait)
  - Only proceed to `media_publish` once status is `FINISHED`
  - If status is `ERROR`, report failure immediately

**`supabase/functions/schedule-meta-post/index.ts`**
- Same polling logic added between container creation and publishing

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/publish-meta-post/index.ts` | Add container status polling before `media_publish` |
| `supabase/functions/schedule-meta-post/index.ts` | Add container status polling before `media_publish` |

