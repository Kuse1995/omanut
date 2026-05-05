# Forward Inbound Media to OpenClaw

OpenClaw's Drafter pipeline is already live (`openclaw-dispatch` sends `reply_to_url`, `drafter_mode`, `recent_history`; `openclaw-reply` handles `send` / `handoff` / `skip` with HMAC verification + 30s dedup). The only remaining gap is media: when a customer sends an image or voice note, OpenClaw currently only sees the text caption.

## Change

Extend `openclaw-dispatch` so the payload includes the customer's inbound media URLs from the latest message.

### Payload addition

```json
{
  "event_id": "...",
  "drafter_mode": true,
  "reply_to_url": "...",
  "recent_history": [...],
  "company_brief": {...},
  "inbound": {
    "text": "...",
    "media_urls": ["https://...", "https://..."],
    "media_count": 2
  }
}
```

### Source of media

- Pull from the triggering `whatsapp_messages.message_metadata.media_urls[]` (already populated by inbound webhook per the Customer Media Forwarding memory).
- For Twilio URLs, append basic-auth credentials inline (`https://{SID}:{TOKEN}@api.twilio.com/...`) so OpenClaw can fetch without separate auth setup — same trick we use elsewhere for Twilio media auth.
- For Meta media, leave as-is (already publicly fetchable with the URL).

### Docs

Update `OPENCLAW_INTEGRATION.md` with the new `inbound.media_urls` field and a note that Twilio URLs are pre-authenticated.

## Out of scope

- No DB migration.
- No changes to `openclaw-reply` (handoff / skip / dedup already correct).
- No changes to Omanut's outbound senders.
