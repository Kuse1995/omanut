# Make OpenClaw the Sole Brain (with 2-min safety net)

## Goal

Your laptop's OpenClaw loop becomes the only AI that talks to customers across **WhatsApp, Facebook/Instagram DMs, and FB/IG comments** for all 8 companies. The in-house AI stays silent unless OpenClaw fails to claim an event within **2 minutes** — then it drains the straggler so customers are never ghosted.

## How it works

```text
Customer message
      │
      ▼
inbound_events (status=pending)
      │
      ├──► OpenClaw on your laptop (every 25s via MCP)
      │         claims → answers → mark_event_handled
      │
      └──► [if pending > 2 min] in-house openclaw-worker takes over
                claims → swarm AI answers → sends
```

Two switches control this:

- **`companies.openclaw_mode = 'primary'`** + **`openclaw_owns = {whatsapp:true, dm:true, comments:true}`** for every company → tells the in-house worker "don't touch this, OpenClaw owns it."
- **`OPENCLAW_PULL_GRACE_SECONDS = 120`** env var on `openclaw-worker` → the worker already respects a grace window; bumping it to 120s means OpenClaw gets a full 2 minutes before fallback kicks in.

That's it. No new tables. No new edge functions. The plumbing is already there from previous iterations — we just flip the flags consistently.

## Changes

### 1. Database migration (one-shot config flip for all 8 companies)

```sql
UPDATE public.companies
   SET openclaw_mode = 'primary',
       openclaw_owns = jsonb_build_object(
         'whatsapp', true,
         'dm',       true,
         'comments', true
       );
```

### 2. Bump the grace window so OpenClaw has 2 full minutes

Set the Supabase function secret `OPENCLAW_PULL_GRACE_SECONDS = 120` (currently defaults to 8s). The `openclaw-worker` already reads it at line 56:

```ts
const GRACE_SECONDS = Number(Deno.env.get('OPENCLAW_PULL_GRACE_SECONDS') ?? '8');
```

So the cron'd worker will skip any event younger than 2 minutes — giving OpenClaw exclusive first dibs.

### 3. Patch `openclaw-worker` to honor the WhatsApp release path consistently

The worker today already has the release-to-OpenClaw logic for WhatsApp (lines 156–171), but it only triggers when `explicitId` is passed. For DM + comments, when OpenClaw is primary, the worker should similarly **skip + leave pending** during the grace window instead of processing.

Small surgical change in `processOne`:

- If `company.openclaw_mode === 'primary'` AND the matching `openclaw_owns[<channel>]` is true AND the event is younger than `GRACE_SECONDS`, release back to `pending` and return.
- This applies to `direct_message` and `public_comment` the same way it already does for `whatsapp`.

### 4. Visible status surface (so you know OpenClaw is actually winning)

Tiny UI addition to the **OpenClaw Agent Card** (`src/components/admin/OpenClawAgentCard.tsx`):

- Show "Last heartbeat: 12s ago" (already tracked via `openclaw_last_heartbeat`)
- Show "Events handled (last hour): N by openclaw / M by fallback worker" — single SQL count grouped by `consumed_by`.

This is the only frontend touch; no new pages.

## Behavior matrix after rollout

| Scenario | What happens |
|---|---|
| Laptop online, OpenClaw loop running | Every customer message handled by your laptop within ~25s |
| Laptop offline / loop crashed | Events sit pending for 2 min, then in-house worker drains them |
| Laptop comes back mid-backlog | OpenClaw picks up everything still pending (worker only takes events >2min old) |
| You manually disable OpenClaw on one company | Set `openclaw_mode='off'` on that company — worker resumes immediately |

## Out of scope

- The Twilio `401 Authenticate` send failure — separate item, doesn't block this work (OpenClaw will hit the same wall when it tries to send, but that's an outbound credential issue, not a routing one).
- Per-channel granularity beyond on/off (e.g. "OpenClaw owns WhatsApp but not comments for company X") — the schema supports it; we just won't expose UI for it now.
- Any change to the MCP tool surface (`list_pending_events` / `mark_event_handled`) — already correct after recent fixes.

## Verification steps after build

1. Run the migration; confirm all 8 companies show `openclaw_mode='primary'`.
2. Confirm secret `OPENCLAW_PULL_GRACE_SECONDS=120` is set.
3. Send a test WhatsApp to any company; watch `inbound_events` — it should stay `pending` until OpenClaw claims it via MCP.
4. Stop your local OpenClaw loop; send another test; wait ~2 min; confirm `openclaw-worker` takes over (`consumed_by='worker'`).
5. Restart OpenClaw; confirm new events go back to `consumed_by='openclaw:oai_36e7c3ea'`.
