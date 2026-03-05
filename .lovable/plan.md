

## Autonomous Content Engine

### Overview
Build a system where AI proactively creates social media posts (caption + image) and saves them for human review before publishing. Three parts: schema update, edge function, and approval UI.

### 1. Database Update
The `scheduled_posts` table already has a `status` column supporting `draft`, `scheduled`, `published`, `failed`. We need to add `pending_approval` as a valid state. Since it's a text column (no enum constraint), no migration is needed -- we just use the new value in code. The `publish-meta-post` function checks `status !== 'draft'`, so we'll also need it to accept `scheduled` status (posts approved from the queue).

### 2. New Edge Function: `auto-content-creator`

**File:** `supabase/functions/auto-content-creator/index.ts`

When triggered with a `company_id`:
1. Fetch company info (`companies` table: name, business_type) and AI settings (`company_ai_overrides`: system_instructions)
2. Fetch image generation settings and any reference/approved images from `generated_images` and `company_media` for style context
3. Call Lovable AI (`google/gemini-3-flash-preview`) to brainstorm an engaging social media caption based on company context
4. Call Lovable AI image generation (`google/gemini-3-pro-image-preview`) to create a matching image, referencing brand style
5. Upload the base64 image to `company-media` storage bucket, get public URL
6. Calculate `scheduled_time` = now + 2 days
7. Look up the company's `meta_credentials` to get the `page_id`
8. Insert into `scheduled_posts` with `status: 'pending_approval'`, `target_platform: 'both'`

Config: `verify_jwt = true`, `timeout = 60`

### 3. Frontend: Approval Queue UI

**Update:** `src/components/admin/ContentSchedulerPanel.tsx`

- Add a top-level tab structure: **Compose** | **Approval Queue** | **All Posts**
- Move existing compose form into "Compose" tab, existing post list into "All Posts" tab
- New **Approval Queue** tab:
  - Fetches posts with `status = 'pending_approval'` for the selected company
  - Each card shows: image thumbnail, AI-generated caption (editable textarea), scheduled time (editable date/time input), platform badge
  - **Approve** button: updates status to `scheduled`, then calls `schedule-meta-post` to register with Meta
  - **Edit & Approve**: allows inline editing of caption and time before approving
  - **Reject** button: deletes the post or sets status to `failed`
- Add a **Generate Content** button that triggers the `auto-content-creator` edge function for the current company
- Update `statusBadge` helper to handle `pending_approval` state (orange/amber badge with "Pending Review" label)

### 4. Config Update

Add to `supabase/config.toml`:
```toml
[functions.auto-content-creator]
  timeout = 60
  verify_jwt = true
```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/auto-content-creator/index.ts` | New edge function |
| `supabase/config.toml` | Add function config |
| `src/components/admin/ContentSchedulerPanel.tsx` | Add Approval Queue tab, Generate Content button, inline editing |

