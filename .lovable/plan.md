

# End-to-End Test Plan: Boss Approval Flow + Cron Jobs

## Cron Jobs Status: All Healthy

All 8 cron jobs are **active and succeeding** consistently:

| Job | Schedule | Status |
|---|---|---|
| `publish-due-posts` (cron-publisher) | Every minute | Succeeding, "No due posts" |
| `boss-media-watchdog` | Every 2 min | Succeeding, 0 records (no media to track yet) |
| `sla-escalation-check` | Every 2 min | Succeeding |
| `csat-followup-check` | Every 5 min | Succeeding |
| `analyze-followup-morning` | 9:00 UTC | Succeeding |
| `analyze-followup-afternoon` | 14:00 UTC | Succeeding |
| `analyze-followup-evening` | 18:00 UTC | Succeeding |
| `daily-briefing-morning` | 8:00 UTC | Succeeding |

No failures in recent run history. The `boss_media_deliveries` table is empty (no media sends have been tracked yet), and there are no `pending_approval` posts — confirming nothing has been tested yet.

## End-to-End Test: Approval Flow

To test the full flow, I'll invoke the `boss-chat` function directly with a simulated message asking to create a post with an image, targeting **Finch Investments Limited** (has Meta credentials with both Facebook and Instagram configured).

### Test Steps

1. **Simulate boss message** — Call `boss-chat` with a message like "Create a post about our investment services with a nice image" for Finch Investments
2. **Verify response** — Check that:
   - A `scheduled_posts` row is created with `status = 'pending_approval'`
   - The response includes `imageUrl` and `mediaMessages` for WhatsApp delivery
   - The response asks for approval (not auto-scheduling)
3. **Check watchdog** — Confirm `boss_media_deliveries` gets a tracking row after the media send
4. **Simulate approval** — Send "approve" to boss-chat and verify the post moves to `approved` status
5. **Check cron-publisher** — Verify it picks up the approved post and publishes it

### What I'll Do

I'll use `curl_edge_functions` to call the boss-chat function directly (bypassing Twilio/WhatsApp), inspect the database state at each step, and check edge function logs for the full trace. This avoids needing to send an actual WhatsApp message.

### Limitations

- Image generation may take 30-60 seconds and could hit rate limits
- Actual WhatsApp delivery won't happen (no Twilio call in direct invocation) — but we can verify the response shape includes the media data
- The watchdog tracking only fires in the `whatsapp-messages` path, so direct boss-chat calls won't populate `boss_media_deliveries` — but we can verify the data structure is correct

