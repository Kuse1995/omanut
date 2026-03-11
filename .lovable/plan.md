

# Cron Job: Detect Undelivered Boss Media Messages

## Problem

When `boss-chat` returns an `imageUrl` or `mediaMessages`, the `whatsapp-messages` function sends them via Twilio. But if Twilio fails (timeout, bad URL, rate limit), the boss never sees the image — and nobody knows. There's no record of what was *intended* to be sent vs what was *actually delivered*.

## Approach

**Log intended media → check delivery → retry or alert.**

### 1. New table: `boss_media_deliveries`

Tracks every image the system intends to send to the boss.

```text
id              uuid PK
company_id      uuid
boss_phone      text
image_url       text
context         text        -- e.g. "scheduled_post_preview", "product_image", "brand_asset"
related_id      uuid        -- optional: scheduled_post id, generated_image id, etc.
twilio_sid      text        -- filled after Twilio returns a SID
status          text        -- 'pending' → 'sent' → 'delivered' / 'failed' / 'undelivered'
retry_count     int default 0
max_retries     int default 3
error_message   text
created_at      timestamptz
updated_at      timestamptz
```

### 2. Log intended sends in `whatsapp-messages/index.ts`

When the boss-chat response includes `imageUrl` or `mediaMessages`, insert a row into `boss_media_deliveries` with status `pending` *before* calling Twilio. After a successful Twilio send, update the row with the Twilio message SID and set status to `sent`. On failure, set status to `failed` with the error.

### 3. New edge function: `boss-media-watchdog/index.ts`

A cron-triggered function that:

1. **Finds stale `pending` rows** — created >2 minutes ago but never got a Twilio SID (send never happened or crashed mid-flight). Retries the Twilio send.
2. **Finds `sent` rows >5 minutes old** — checks Twilio message status API. If Twilio reports `undelivered` or `failed`, marks accordingly and retries.
3. **Finds `failed` rows with retry_count < max_retries** — retries the send.
4. **After max retries exhausted** — sends a text-only fallback to the boss: `"⚠️ I tried to send you an image but it didn't go through. Here's the link: {url}"`.

### 4. Register the cron job

Use `pg_cron` to call `boss-media-watchdog` every 2 minutes.

## Files

| File | Action |
|---|---|
| `boss_media_deliveries` table | New migration |
| `supabase/functions/boss-media-watchdog/index.ts` | New function |
| `supabase/functions/whatsapp-messages/index.ts` | Insert tracking rows around Twilio boss-media sends |
| `supabase/config.toml` | Add `boss-media-watchdog` entry |
| `pg_cron` SQL | Schedule every 2 minutes |

## Bonus fix

Line 1340 currently pushes a raw string into `toolMediaMessages` (which expects `{ body, imageUrl }`). This will be fixed to push the correct object shape.

