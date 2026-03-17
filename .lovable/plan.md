

# Fix: Video Generation Times Out — Async Pipeline Needed

## Problem

The `veoGenerateVideo` function polls for up to **4 minutes** (48 polls × 5s), but `boss-chat` has a **120s hard timeout**. The edge function gets killed by the platform before the video finishes generating. The boss receives the "🎬 Generating video..." ack but never gets the result.

## Solution: Asynchronous Video Generation

Split video generation into two parts:
1. **boss-chat** starts the Veo operation and saves the operation name to DB, then returns immediately
2. A new **`poll-video-generation`** edge function handles polling and delivery, triggered by cron every 30 seconds

## Changes

### 1. Database: `video_generation_jobs` table

```sql
CREATE TABLE public.video_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  operation_name text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,  -- pending, completed, failed
  prompt text,
  aspect_ratio text DEFAULT '9:16',
  boss_phone text NOT NULL,
  video_url text,
  error_message text,
  scheduled_post_data jsonb,  -- optional: auto-schedule after generation
  poll_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### 2. `gemini-client.ts`: New `veoStartGeneration` function

Extract just the "start operation" part of `veoGenerateVideo` (lines 267-347) into a new function that returns `{ operationName }` without polling. Keep the existing `veoGenerateVideo` for any future synchronous use.

### 3. `boss-chat/index.ts`: Update `generate_video` handler

Replace the synchronous `await veoGenerateVideo(...)` call (lines 2127-2164) with:
- Call `veoStartGeneration()` to get the operation name
- Insert a row into `video_generation_jobs` with the operation name, boss phone, company ID
- Return immediately with "🎬 Video generation started! You'll receive it in 1-4 minutes."

### 4. New edge function: `poll-video-generation/index.ts`

- Triggered by cron every 30 seconds
- Queries `video_generation_jobs WHERE status = 'pending' AND poll_count < 60`
- For each job, polls `v1beta/{operationName}` once
- If done: upload video to storage, update job status to `completed`, send video to boss via Twilio WhatsApp
- If `scheduled_post_data` exists in the job, auto-create/update the scheduled post with the video URL
- Increment `poll_count` on each poll; mark as `failed` if exceeding 60 attempts (~5 minutes)

### 5. `supabase/config.toml`: Add cron schedule

```toml
[functions.poll-video-generation]
verify_jwt = false
```

Add pg_cron job to call every 30 seconds (via migration).

## Files Modified/Created
- `supabase/functions/_shared/gemini-client.ts` — add `veoStartGeneration()`
- `supabase/functions/boss-chat/index.ts` — make `generate_video` async (fire-and-forget)
- `supabase/functions/poll-video-generation/index.ts` — new poller + delivery
- DB migration — `video_generation_jobs` table + cron job

