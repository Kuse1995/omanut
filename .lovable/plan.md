

## Fix: Move Scheduling from Meta API to Supabase Cron

### Problem
Instagram Graph API doesn't support `scheduled_publish_time`. Posts intended for future scheduling are published immediately. The current architecture relies on Meta's scheduling, which only works for Facebook.

### Solution
Replace Meta-side scheduling with a Supabase cron-based publisher. Approval now just sets status to `approved`. A cron job checks every minute for due posts and publishes them via the existing `publish-meta-post` function.

### Changes

#### 1. Dashboard UI (`src/components/admin/ContentSchedulerPanel.tsx`)
- **Approve mutation**: Remove the `supabase.functions.invoke('schedule-meta-post')` call. Just update status to `approved`.
- **Compose "Schedule" flow**: Instead of calling `schedule-meta-post`, insert the post with status `approved` (it will be published by the cron when due).
- Update toast messages accordingly ("Post approved! It will be published at the scheduled time.").

#### 2. Boss Chat (`supabase/functions/boss-chat/index.ts`)
- **`approve` action**: Remove the fetch to `schedule-meta-post`. Just set status to `approved`.
- **`approve_and_publish` action**: Keep as-is (calls `publish-meta-post` for immediate publish).
- Update system prompt to reflect that "approve" now means the cron will handle publishing at the scheduled time.

#### 3. New Edge Function: `cron-publisher`
**File:** `supabase/functions/cron-publisher/index.ts`

Logic:
1. Query `scheduled_posts` where `status = 'approved'` AND `scheduled_time <= now()`
2. For each due post, call `publish-meta-post` internally (reuse existing publishing logic)
3. Log results

Config in `supabase/config.toml`:
```toml
[functions.cron-publisher]
  timeout = 60
  verify_jwt = false
```

#### 4. Cron Job (pg_cron)
Set up a cron job to invoke the `cron-publisher` function every minute:
```sql
SELECT cron.schedule('publish-due-posts', '* * * * *', $$
  SELECT net.http_post(
    url:='https://dzheddvoiauevcayifev.supabase.co/functions/v1/cron-publisher',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer <anon_key>"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
$$);
```

#### 5. Schedule-meta-post cleanup
This function is no longer needed for future scheduling. We can leave it in place but it will no longer be called by the approval flows.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/cron-publisher/index.ts` | New: queries due approved posts, calls publish-meta-post for each |
| `supabase/config.toml` | Add cron-publisher config |
| `src/components/admin/ContentSchedulerPanel.tsx` | Remove schedule-meta-post calls, set status to `approved` |
| `supabase/functions/boss-chat/index.ts` | Remove schedule-meta-post call from approve action, set status to `approved` |
| pg_cron SQL | Insert cron schedule to run every minute |

