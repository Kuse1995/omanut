

# Plan: Enterprise-Ready AI-Augmented Customer Service Platform

## Overview
Transform the platform from "AI replaces humans" to "AI empowers humans" -- making it enterprise-ready for high-volume customer service operations where AI handles triage, information gathering, and routing while humans retain control of resolution and relationship management.

This is NOT about adding more AI agents. It's about making the existing system work as an enterprise-grade human-AI collaboration tool.

---

## Core Philosophy Change

The current system tries to resolve everything automatically. Enterprise customer service companies need the opposite: AI as a **first responder** that triages, collects information, and routes to the right human -- never replacing them.

---

## What Changes

### 1. New "Human-First" Mode (Database + Edge Function)

Add a `service_mode` column to `company_ai_overrides` with values:
- `autonomous` (current behavior -- AI resolves everything)
- `human_first` (new -- AI triages and routes to humans)
- `hybrid` (AI handles simple queries, escalates complex ones)

When `human_first` is active:
- AI collects customer name, issue details, and context
- AI creates a support ticket automatically
- AI provides immediate acknowledgment and estimated wait time
- AI routes ticket to the right department/employee
- Human agent picks up from the admin dashboard
- AI assists the human with suggested responses (not auto-sends)

### 2. Live Agent Queue & Assignment System (Database)

New `agent_queue` table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| company_id | uuid | FK to companies |
| ticket_id | uuid | FK to support_tickets |
| conversation_id | uuid | FK to conversations |
| assigned_agent_id | uuid | Human agent user ID (nullable until claimed) |
| department | text | Target department |
| priority | text | low/medium/high/urgent |
| status | text | waiting/assigned/active/on_hold/completed |
| customer_phone | text | For quick reference |
| customer_name | text | Collected by AI |
| ai_summary | text | AI-generated issue summary |
| ai_suggested_responses | jsonb | Array of draft responses |
| sla_deadline | timestamptz | Based on priority |
| wait_time_seconds | integer | Time in queue |
| created_at | timestamptz | When queued |
| claimed_at | timestamptz | When agent claimed |
| completed_at | timestamptz | When resolved |

RLS: Company members can view; contributors+ can claim/update.

Enable realtime on this table so the dashboard updates live.

### 3. SLA Configuration (Database)

New `company_sla_config` table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| company_id | uuid | FK to companies |
| priority | text | low/medium/high/urgent |
| response_time_minutes | integer | Target first response time |
| resolution_time_minutes | integer | Target resolution time |
| escalation_after_minutes | integer | Auto-escalate if breached |
| notification_channels | jsonb | Where to alert (WhatsApp, dashboard) |

### 4. Human Agent Dashboard (Frontend)

New `AgentWorkspace.tsx` component replacing the current simple ticket view:

**Queue View:**
- Real-time list of waiting tickets with priority color coding
- SLA countdown timers (green/yellow/red)
- One-click "Claim" button to take a ticket
- Filter by department, priority, status
- Auto-refresh via Supabase realtime subscription

**Active Conversation View:**
- Full WhatsApp conversation history on the left
- AI-suggested responses panel on the right (click to use, edit before sending)
- Customer profile sidebar: name, phone, past tickets, segment data, conversation history count
- Quick actions: escalate, transfer to another department, mark resolved, add internal note
- Canned response templates (from existing `quick_reply_templates`)

**Performance Metrics (per agent):**
- Tickets handled today/week
- Average response time
- Average resolution time
- SLA compliance percentage
- Customer satisfaction (from follow-up)

### 5. AI Response Suggestions (Edge Function Update)

Modify `whatsapp-messages` to detect `human_first` mode:
- Instead of sending AI response directly to customer, store it as a **draft** in `agent_queue.ai_suggested_responses`
- Generate 2-3 response options with different tones (formal, friendly, concise)
- Human agent reviews, optionally edits, then sends
- The send action goes through the existing WhatsApp message pipeline

### 6. Internal Notes System (Database)

New `ticket_notes` table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| ticket_id | uuid | FK to support_tickets |
| author_id | uuid | User who wrote the note |
| content | text | Note content |
| is_internal | boolean | Never shown to customer |
| created_at | timestamptz | When written |

This lets agents collaborate on complex tickets without the customer seeing internal discussions.

### 7. Customer Satisfaction Follow-Up

After a ticket is resolved, the AI sends a WhatsApp follow-up:
- "Hi [Name], your issue [TKT-XXX] has been resolved. How would you rate your experience? Reply 1-5"
- Response is stored in `support_tickets.satisfaction_score`
- Feeds into agent performance metrics

### 8. Shift/Availability Management

New columns on `company_users`:
- `is_available` (boolean) -- agent is online and taking tickets
- `max_concurrent_tickets` (integer, default 5)
- `current_ticket_count` (integer) -- auto-updated

Queue assignment logic considers:
1. Agent availability
2. Current load (don't overload)
3. Department match
4. Round-robin within qualified agents

---

## Technical Details

### Modified Files

| File | Action | Description |
|------|--------|-------------|
| Migration SQL | Create | `agent_queue`, `company_sla_config`, `ticket_notes` tables + columns on `company_users` and `support_tickets` |
| `supabase/functions/whatsapp-messages/index.ts` | Modify | Add `human_first` mode detection -- queue instead of auto-respond |
| `src/components/admin/TicketsPanel.tsx` | Replace | Full agent workspace with queue, conversation view, AI suggestions |
| `src/components/admin/AdminContentTabs.tsx` | Modify | Add "Agent Workspace" tab |
| `src/components/admin/AdminIconSidebar.tsx` | Modify | Add workspace icon |
| `src/components/admin/CompanySettingsPanel.tsx` | Modify | Add service mode toggle and SLA configuration |
| `src/components/admin/deep-settings/ToolControlPanel.tsx` | Modify | Add human-first mode tools |

### Queue Flow

```text
Customer sends WhatsApp message
        |
  AI analyzes intent + collects info
        |
  service_mode = "human_first"?
        |
    YES: Create ticket + queue entry
         Send customer: "Thanks [Name], ticket TKT-XXX created.
         A team member will be with you shortly."
         Store AI draft responses in queue
        |
    NO: Current behavior (AI responds directly)
        |
  Agent sees ticket in real-time dashboard
        |
  Agent clicks "Claim" --> status = assigned
        |
  Agent views conversation + AI suggestions
        |
  Agent sends response (via existing WhatsApp pipeline)
        |
  Agent resolves ticket --> follow-up survey sent
```

### SLA Escalation Logic

A background check (could be a cron or realtime trigger) monitors queue entries:
- If `wait_time > sla_config.response_time_minutes` and status is still `waiting`:
  - Bump priority
  - Send WhatsApp notification to boss
  - Flag in dashboard with red SLA indicator

### Realtime Updates

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_notes;
```

This enables the agent dashboard to update instantly when:
- New tickets arrive
- Another agent claims a ticket
- SLA timers change state

---

## What This Achieves for Enterprise

1. **Scalability** -- Multiple human agents can work simultaneously with load balancing
2. **Accountability** -- Every ticket is tracked with SLA compliance metrics
3. **Quality** -- AI assists but humans control the final message
4. **Visibility** -- Managers see real-time queue depth, agent performance, and SLA health
5. **Customer trust** -- Customers know a real person is handling their issue
6. **AI leverage** -- AI still does the heavy lifting (triage, info collection, draft responses) but humans make the decisions

