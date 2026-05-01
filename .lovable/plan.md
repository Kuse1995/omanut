## Goal

Stand up the unified Meta webhook handler your spec describes, but as a **Supabase edge function** (not Express on Railway) and **layered on top of our existing `meta-webhook`** instead of replacing it. OpenClaw takeover stays driven by the `openclaw_mode` / `openclaw_owns` flags we already wired.

## Why no new function (and no Express)

Our `supabase/functions/meta-webhook/index.ts` already:
- Handles `GET /webhook` verification with `META_VERIFY_TOKEN`
- Verifies `X-Hub-Signature-256` using `META_APP_SECRET`
- Parses all five payload shapes in your spec: WhatsApp messages, FB Messenger DMs, Instagram DMs, FB feed comments, IG comments
- Resolves `company_id` from `phone_number_id` / `page_id` / `ig_user_id` via `meta_credentials`
- Returns 200 immediately and processes async

Rebuilding this as a separate Express service on Railway would duplicate ~1,200 lines of working signature/verification/routing code and split our Meta surface across two hosts. The clean move is to add a single fork point inside the existing handler.

## What changes

### 1. New helper: `forwardToOpenclaw(skill, normalizedPayload)`

Added to `supabase/functions/_shared/openclaw-gate.ts`. Reuses the existing `isOwnedByOpenclaw()` check, then POSTs the normalized event directly to the company's MCP URL (defaulting to the project's `mcp-server` function). Payloads match your spec exactly:

```text
whatsapp         → { company_id, channel:'whatsapp', from, message, message_id, timestamp }
facebook         → { company_id, channel:'facebook', from, page_id, message, message_id, timestamp }
instagram        → { company_id, channel:'instagram', from, instagram_id, message, message_id, timestamp }
facebook_comment → { company_id, channel:'facebook_comment', from, commenter_name, page_id,
                     comment_id, post_id, message, parent_id, timestamp }
instagram_comment→ { company_id, channel:'instagram_comment', from, username, instagram_id,
                     comment_id, media_id, message, timestamp }
```

Signed with `OPENCLAW_WEBHOOK_SECRET` via the existing `X-Openclaw-Signature` header so the receiver can verify.

### 2. Fork point inside `meta-webhook`

At each of the five existing per-event branches, before invoking our internal AI handler (`handleComment`, `handleInstagramComment`, `handleMessenger`, `handleWhatsApp`, etc.), insert:

```text
if (await isOwnedByOpenclaw(supabase, companyId, skill)) {
  await forwardToOpenclaw(skill, normalizedPayload);
  continue;            // OpenClaw owns the reply, do NOT run internal AI
} else {
  // existing behavior unchanged
}
```

Skill mapping:
- WhatsApp messages → `'whatsapp'`
- FB Messenger DMs → `'meta_dm'`
- IG DMs → `'meta_dm'`
- FB feed comments → `'comments'`
- IG comments → `'comments'`

### 3. No DB changes, no new function, no new secrets

- Verification token, app secret, OpenClaw secret all already exist (`META_VERIFY_TOKEN`, `META_APP_SECRET`, `OPENCLAW_WEBHOOK_SECRET` — add this one if missing).
- `companies.openclaw_mode` / `openclaw_owns` already control routing.
- The webhook URL Meta points at stays the same: `https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-webhook`.

## Flow after the change

```text
Meta ──POST──► meta-webhook (verify sig, parse, resolve company_id)
                  │
                  ├─ openclaw_mode=primary & owns(skill)? ──► forwardToOpenclaw ──► MCP server
                  │                                                                   │
                  │                                                                   └─ OpenClaw replies via send_* MCP tools
                  │
                  └─ otherwise ──► existing internal AI flow (whatsapp-messages / meta DM handler / comment handler)
```

## What you do after I ship

1. Confirm `OPENCLAW_WEBHOOK_SECRET` is set (I'll prompt if not).
2. Per company, in the admin OpenClaw card: set `openclaw_mode='primary'` and tick the skills OpenClaw should own.
3. That's it — Meta webhook URL is unchanged.

## Out of scope

- No Express service, no Railway deploy, no new public hostname.
- No changes to reply tools — replies still go through `send_whatsapp_message` / `send-meta-dm` / comment-reply MCP tools as before.
- No replacement of the existing internal AI path; it stays as the failover when `openclaw_mode != primary`.
