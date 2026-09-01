# TASK 2: Verify the Omanut comment pipeline end-to-end

Prerequisite: TASK 1 (docs/TASK-fix-page-webhook.md) is done — the page webhook
subscription is fixed. This task verifies + activates the rest of the pipeline.

## Current state (verified 2026-09-01)
- meta-auto-reply worker: DEPLOYED and functional (returns 200 {"ok":true,"processed":0}).
- 4 old FB comment events stuck 'pending' (July 26-29) — the claim window migration
  (20260901010000_widen_claim_window_30d.sql) has NOT been applied to the live DB yet.
- The 30s cron schedule migration (20260901000000_schedule_meta_auto_reply.sql) has NOT
  been applied yet either (no pg_cron job 'meta-auto-reply-30s' running).
- All 7 companies: harness_mode = on (verified).
- Harness farm service: live, GLM-5.3-Flash, healthy.

## Steps

### 1. Apply the two migrations
Run in Supabase SQL Editor (project dzheddvoiauevcayifev) — both are on main:
- supabase/migrations/20260901000000_schedule_meta_auto_reply.sql
  (schedules pg_cron job 'meta-auto-reply-30s' → net.http_post to the worker every 30s)
- supabase/migrations/20260901010000_widen_claim_window_30d.sql
  (widens claim_pending_events from 1 hour to 30 days — frees the 4 stuck events)

Verify after:
- SELECT jobname, schedule FROM cron.job WHERE jobname = 'meta-auto-reply-30s';
- The 4 old events: SELECT id, status, created_at FROM inbound_events
  WHERE channel='public_comment' ORDER BY created_at DESC; → wait ~60s, statuses
  should flip from 'pending' to 'processing'/'sent' as the cron drains them.

### 2. Verify the cron drains the queue
- Wait 60-90 seconds after applying migrations.
- POST to https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-auto-reply
  (no auth needed) — expect processed > 0 on the first run (the 4 old events).
- Check the replies appear on the Facebook posts (or confirm statuses = 'sent').

### 3. End-to-end test with a NEW comment
- Comment on the Omanut Technologies Facebook page.
- Within ~30-60s: the cron triggers the worker → claims the event → harness replies.
- Verify: new row in inbound_events (status sent), new row in facebook_comments,
  the harness log on the farm gets a new turn
  (ssh to the farm: tail /opt/farm/outputs/omanut-harness/data/harness.log).

### 4. Report
- Confirm which migrations applied, whether the 4 old events were answered,
  and whether a NEW comment round-trips end-to-end.

## Reference
- Repo: C:\Users\user\Documents\Codex\2026-08-04\we\work\omanut (AGENTS.md, docs/HANDOFF.md)
- meta-auto-reply source: supabase/functions/meta-auto-reply/index.ts
- Harness: https://omanut-harness.omanut.online (GLM-5.3-Flash)
