# TASK: Re-subscribe Omanut FB page webhook via Meta DevTools MCP

You have the Meta Developer Tools MCP server connected (meta_devtools).
Use it to fix the Omanut Technologies Facebook page webhook subscription.

## Context
- Meta App ID: 882548657500573 (Omanut's app)
- Supabase project: dzheddvoiauevcayifev
- Webhook callback URL: https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-webhook
- The webhook subscription for the PAGE has lapsed — no feed comment events since July 29.
- The page is "Omanut Technologies Limited" (company 3408d643-8e9c-4c46-b684-4960fba1e0e9 in the platform DB).

## Steps
1. Call devtools_app_list to confirm you can see app 882548657500573.
2. Call devtools_webhook_list (app_id 882548657500573) to see current webhook subscriptions
   — check the "page" topic: what callback URL and fields are subscribed?
3. The callback URL must be: https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-webhook
   If it's different or missing, use devtools_webhook_manage (action: subscribe) to subscribe
   the "page" topic with:
   - callback_url: https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-webhook
   - fields: feed, messages
   (Note: Meta verifies the callback with a hub.challenge — the meta-webhook function
   answers it using the META_VERIFY_TOKEN secret, so verification should pass.)
4. Use devtools_webhook_test to send a test event to the "feed" field and confirm
   the endpoint responds correctly.
5. Report the final subscription state (callback URL + subscribed fields).

## After the webhook is fixed
The user will comment on the Omanut Technologies Facebook page. The comment should:
- enqueue into inbound_events (channel public_comment)
- be claimed by meta-auto-reply (runs every 30s via pg_cron — migration 20260901000000
  must be applied; check cron.job for 'meta-auto-reply-30s')
- generate a reply via the omanut-harness (GLM-5.3-Flash)

## Reference docs
- Repo: C:\Users\user\Documents\Codex\2026-08-04\we\work\omanut (docs/HANDOFF.md, docs/HARNESS-INTEGRATION.md)
- AGENTS.md at repo root
