

# Autonomous Company-in-a-Box: Recursive Agent Loop via MCP

## Overview

Transform OpenClaw from a reactive tool-caller into a self-directed autonomous agent by adding three capability layers to the MCP server: **BMS operations** (sell, invoice, stock), **Meta platform outbound** (post, message, reply), and **safety guardrails** (budget ceilings, HITL approval, P&L checks). The existing `bms-agent` edge function and `publish-meta-post`/`send-meta-dm` functions are already built — we just need to expose them as MCP tools.

## Architecture

```text
OpenClaw "Mission" (recursive loop)
    │
    ├─ ANALYZE:  get_analytics + get_ai_config
    ├─ RESEARCH: search_knowledge_base + web_search (external)
    ├─ CREATE:   update_knowledge_base + bms_create_product
    ├─ PROMOTE:  publish_facebook_post + create_scheduled_post
    ├─ SELL:     bms_generate_payment_link + send_message
    ├─ AUDIT:    list_ai_errors + bms_profit_loss_report
    │
    └─ GUARDRAILS (checked before risky actions):
         ├─ get_spending_guard   → budget ceiling
         ├─ request_approval     → WhatsApp HITL
         └─ get_financial_health → P&L sanity check
```

## Changes

### 1. Add BMS proxy tools to `mcp-server/index.ts` (~12 tools)

Each tool calls the existing `bms-agent` edge function internally:

| Tool | BMS Intent | Purpose |
|---|---|---|
| `bms_check_stock` | `check_stock` | Verify availability before selling |
| `bms_record_sale` | `record_sale` | Record a completed sale |
| `bms_create_invoice` | `create_invoice` | Generate invoice |
| `bms_send_receipt` | `send_receipt` | Send receipt to customer |
| `bms_generate_payment_link` | `generate_payment_link` | Lenco payment link |
| `bms_get_sales_summary` | `get_sales_summary` | Revenue report |
| `bms_list_products` | `list_products` | Full BMS catalog |
| `bms_low_stock_alerts` | `low_stock_alerts` | Reorder warnings |
| `bms_who_owes` | `who_owes` | Outstanding debts |
| `bms_profit_loss_report` | `profit_loss_report` | P&L for financial health |
| `bms_create_order` | `create_order` | Create order |
| `bms_get_order_status` | `get_order_status` | Track fulfillment |

Implementation: A shared `callBmsViaEdge(companyId, intent, params)` helper that POSTs to the `bms-agent` function with `action` and `params.company_id`.

### 2. Add Meta platform outbound tools (~5 tools)

| Tool | Edge Function Called | Purpose |
|---|---|---|
| `send_facebook_message` | `send-meta-dm` | Send Messenger DM |
| `send_instagram_message` | `send-meta-dm` | Send IG DM |
| `reply_facebook_comment` | `send-facebook-comment-reply` | Reply to FB comment |
| `publish_facebook_post` | `publish-meta-post` | Publish to FB Page now |
| `publish_instagram_post` | `publish-meta-post` | Publish to IG now |

### 3. Add operational control tools (~3 tools)

| Tool | Description |
|---|---|
| `update_ai_config` | Write to `company_ai_overrides` — change model, temperature, system prompt, enabled tools |
| `list_payment_transactions` | Query `payment_transactions` for revenue tracking |
| `get_agent_strategy` | Read current agent routing config from `company_ai_overrides` |

### 4. Add safety guardrail tools (~3 tools)

These are the critical "kill switches" that prevent runaway autonomy:

| Tool | Description |
|---|---|
| `get_spending_guard` | Reads today's total ad spend / payment link creations from DB. Returns `{ allowed: false }` if daily limit exceeded. Agent instructions will require calling this before any spend action. |
| `request_approval` | Sends a WhatsApp message to the company owner with a summary of what the agent wants to do. Returns `{ status: "pending" }`. The agent must wait for approval before proceeding with high-risk actions (sales > threshold, AI config changes, ad spend). |
| `get_financial_health` | Runs `bms_profit_loss_report` + checks `credit_balance` on the company. Returns a `mode` field: `"expansion"` if profitable, `"cost_cutting"` if in the red. Agent uses this to decide strategy. |

### 5. Database: New `agent_spending_limits` table

Stores per-company daily spending caps and approval thresholds:

```sql
CREATE TABLE public.agent_spending_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  daily_ad_budget_limit NUMERIC DEFAULT 50,
  sale_approval_threshold NUMERIC DEFAULT 500,
  require_approval_for_ai_config BOOLEAN DEFAULT true,
  require_approval_for_publishing BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE public.agent_spending_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can view spending limits"
  ON public.agent_spending_limits FOR SELECT TO authenticated
  USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "Managers can update spending limits"
  ON public.agent_spending_limits FOR ALL TO authenticated
  USING (public.has_company_role(company_id, 'manager'));
```

### 6. Database: New `agent_approval_requests` table

Tracks HITL approval requests sent via WhatsApp:

```sql
CREATE TABLE public.agent_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  action_type TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  action_params JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  responded_by TEXT
);

ALTER TABLE public.agent_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can view approval requests"
  ON public.agent_approval_requests FOR SELECT TO authenticated
  USING (public.user_has_company_access_v2(company_id));
```

### 7. Update `openclaw-skill.json`

Add all new tools to the `tools_overview` organized by category: `bms_operations`, `meta_platform`, `operational_control`, `safety_guardrails`.

## Files Modified

- `supabase/functions/mcp-server/index.ts` — add ~23 new tools (BMS, Meta, control, guardrails)
- `openclaw-skill.json` — expanded tools overview
- **New migration** — `agent_spending_limits` + `agent_approval_requests` tables with RLS

## Autonomous Loop Example

```text
1. ANALYZE:  get_analytics → "Revenue dropped 30% this week"
2. RESEARCH: search_knowledge_base → "No new products in 60 days"
3. DECIDE:   get_financial_health → mode: "expansion" (still profitable)
4. CREATE:   update_knowledge_base → save product spec
5. STOCK:    bms_list_products → verify no duplicate
6. GUARD:    get_spending_guard → { allowed: true, remaining: $45 }
7. PROMOTE:  create_scheduled_post → FB + IG post with payment link
8. GUARD:    request_approval → WhatsApp to owner: "Publish product X at $29?"
9. SELL:     (after approval) bms_generate_payment_link → attach to post
10. AUDIT:   list_ai_errors + bms_profit_loss_report → log results
```

## Security Notes

- All BMS calls proxied through `bms-agent` (validates BMS connection per company)
- All Meta calls go through existing edge functions with company-scoped credentials
- Guardrail tools are **read-only checks** — they don't block directly, but the agent's mission instructions enforce calling them before risky actions
- `request_approval` creates an audit trail in `agent_approval_requests`
- AI config updates scoped to authenticated company only

