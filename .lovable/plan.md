

# Plan: Live Demo Feed on Banking Pitch Page + Eco Bank Setup

## Part 1: Setting Up "DEMO Eco Bank"

This is done by texting **DEMO Eco Bank** to the WhatsApp number +1 (334) 508-3612 from the boss phone (+260972064502). The AI will automatically research Eco Bank and configure the demo session. No code changes needed for this step — it's a manual action before the demo meeting.

## Part 2: Live Activity Feed on /pitch/banking

### Problem
The pitch page is public (no authentication), but the database tables for messages, tickets, and queue items have row-level security that requires authentication. Direct client-side queries won't work.

### Solution
Create a backend function that serves live demo data without requiring authentication, then add a "Live Activity" section to the banking pitch page.

### Changes

**1. Create edge function: `supabase/functions/demo-live-feed/index.ts`**

A public endpoint that returns:
- Active demo session info (company name, status)
- Recent messages (last 20) across demo conversations
- Support tickets created during the demo
- Agent queue items (ticket assignments)
- Basic stats (total conversations, active count, handoff count)

Uses the service role key internally so RLS is bypassed. Scoped strictly to the demo company ID (`332b4f2c-9255-47f6-be9e-69e52ea22656`).

**2. Update `src/pages/PitchBanking.tsx`**

Add a new "Live Activity" section after the CTA/QR code section with three panels:

- **Live Conversation Feed**: Shows real-time messages between customers and the AI, auto-refreshing every 5 seconds. Each message shows role (Customer/AI), content, and timestamp.
- **Tickets Created**: Shows support tickets the AI created during the demo — ticket number, customer name, issue summary, priority badge, assigned department.
- **Agent Queue**: Shows which tickets have been claimed by agents, SLA countdown, and status.

The section uses a polling approach (fetch every 5s) to the edge function. Styled consistently with the rest of the pitch page (dark, enterprise-grade).

**3. Update `supabase/config.toml`** — not needed, auto-handled by deployment.

### Files

| Action | File |
|--------|------|
| Create | `supabase/functions/demo-live-feed/index.ts` |
| Edit   | `src/pages/PitchBanking.tsx` — add Live Activity section |

### Demo Day Flow
1. Before the meeting: text **DEMO Eco Bank** to +1 (334) 508-3612 from the boss phone
2. Open `/pitch/banking` on the laptop — present the pitch
3. Invite Eco Bank attendees to scan the QR code and text the number
4. As they interact, the Live Activity section on the pitch page updates in real-time showing their messages, any tickets created, and assignments — all visible on screen during the presentation

