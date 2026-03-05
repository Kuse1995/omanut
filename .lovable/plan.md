

## Plan: Add "Publish Now" to Content Scheduler

### Overview
Add a "Publish Now" button alongside the existing "Schedule Post" button. This creates a new edge function that immediately publishes to Facebook/Instagram (bypassing the 10-min scheduling constraint), and updates the UI to let users choose between scheduling and instant publishing.

---

### 1. New Edge Function: `publish-meta-post`

Create `supabase/functions/publish-meta-post/index.ts` — a streamlined version of `schedule-meta-post` that publishes immediately:

- **Facebook**: `POST /{page_id}/feed` with `published: true` (no `scheduled_publish_time`), or `/{page_id}/photos` with `published: true` for image posts
- **Instagram**: Same two-step flow (create container → publish), which already publishes immediately
- Accepts `post_id`, loads the post record, looks up credentials, publishes, and updates status to `published` with `published_at` timestamp
- Skips the 10-min/75-day time validation since it's instant
- Add `verify_jwt = false` in `config.toml` (manual auth in code, same pattern as other functions)

### 2. UI Changes: `ContentSchedulerPanel.tsx`

- Add a `publishMode` state: `'schedule' | 'now'`
- Add a toggle or tab at the top of the compose form to switch between "Schedule" and "Publish Now"
- When "Publish Now" is selected: hide the date/time inputs, change the button label to "Publish Now", and invoke `publish-meta-post` instead of `schedule-meta-post`
- For instant publish: insert the record with `scheduled_time` set to `now()` and status `draft`, then call the new edge function
- Keep all existing validation (IG requires image, platform selection, etc.)

### 3. Boss Chat Tool Update: `boss-chat/index.ts`

- Add a `publish_now` boolean parameter to the `schedule_social_post` tool
- When `publish_now` is true, call `publish-meta-post` instead of `schedule-meta-post`

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/publish-meta-post/index.ts` | New edge function for instant publishing |
| `supabase/config.toml` | Add `verify_jwt = false` for `publish-meta-post` |
| `src/components/admin/ContentSchedulerPanel.tsx` | Add publish mode toggle and "Publish Now" button |
| `supabase/functions/boss-chat/index.ts` | Add `publish_now` param to scheduling tool |

