

## Honest answer first: you already have most of this — but it's mis-framed

What you're describing (HR mode, Customer Care mode, Sales mode, etc.) **already exists in the codebase** as the multi-agent routing system. Right now it has 3 hardcoded "agents":

- **Support Agent** (Customer Care) — empathy, complaints
- **Sales Agent** — product, closing
- **Boss Agent** — strategic/management

The router (`routing_model`) classifies each incoming WhatsApp message and picks the right agent prompt. You can already see it in **AI Deep Settings → Agents tab** — there's a tab per agent with its own system prompt.

**So the infrastructure is there.** What's missing is:
1. You can't *add new modes* (HR, Logistics, Finance, Recruitment) — the 3 agents are hardcoded.
2. There's no UI to define what triggers each mode (e.g. "if message mentions 'job', 'CV', 'application' → HR mode").
3. Modes can't be enabled/disabled per company (a restaurant doesn't need HR mode; a school does).

### My recommendation: **Yes, build it — but as "Custom Agent Modes," not a separate feature**

Don't build a parallel system. Extend the existing agent routing into a **dynamic, per-company list of modes**. This unlocks HR, Recruitment, Logistics, Finance, Reservations-only, After-hours, etc. — all configurable, no code changes per use case.

### What to build

**1. New table: `company_agent_modes`**
```
id | company_id | name | icon | system_prompt | trigger_keywords[] |
trigger_examples[] | enabled_tools[] | enabled | priority | created_at
```
Replaces the 3 hardcoded prompt fields (`support_agent_prompt`, `sales_agent_prompt`, `boss_agent_prompt`) over time. We migrate those into rows of this table on first load so nothing breaks.

**2. UI: "Agent Modes" tab inside AI Deep Settings**
Replaces the current Support/Sales/Boss tabs with a list view:
- Each mode = a card with: name, icon, prompt textarea, trigger keywords, allowed tools, on/off switch.
- "+ Add Mode" button with templates: HR/Recruitment, Customer Care, Sales, Reservations, Boss/Management, After-Hours, Technical Support, Finance/Billing.
- Drag to reorder priority (router checks high-priority modes first).

**3. Router upgrade in `whatsapp-messages` edge function**
Currently the router only chooses Support / Sales / Boss. Update it to:
- Load all enabled modes for the company.
- Build the routing prompt dynamically from each mode's `name` + `trigger_examples`.
- Return the chosen mode's `id`, then load that mode's `system_prompt` + `enabled_tools`.

**4. Seeded templates per industry**
When a new company is created (or via a "Suggest modes" button), pre-fill modes based on `companies.business_type`:
- Restaurant → Customer Care, Reservations, Boss
- School → Customer Care, HR/Recruitment, Admissions, Boss
- Retail (ANZ, Finch) → Customer Care, Sales, Boss
- Anyone with a careers page → +HR mode

### Why this matters in practice

Right now if a job applicant WhatsApps Finch saying *"I'd like to apply for the cashier role"*, the AI hits the Sales prompt and tries to sell them a pan. With HR mode + the keyword `apply|CV|job|hiring` → router picks HR mode → AI collects name, role, CV, and notifies the boss via the existing `notify_boss` tool. Same plumbing, different face.

### What NOT to do

- Don't build a separate "modes" toggle on top of the existing agent system — it would duplicate logic.
- Don't expose this to every customer initially — start by enabling it for ANZ + one other company that actually has HR needs (does Omanut?), validate, then roll out.
- Don't make it a global mode switch the user manually flips. The router should pick automatically based on message content. Manual override only for edge cases.

### Files to touch

- **DB migration**: create `company_agent_modes` + seed function + trigger to copy legacy `support_agent_prompt`/`sales_agent_prompt`/`boss_agent_prompt` into rows on first read.
- **`src/components/admin/deep-settings/AgentConfigPanel.tsx`** — replace the 5 hardcoded tabs with a dynamic list (keep Boss + Supervisor as special pinned modes since they have extra config panels).
- **New**: `src/components/admin/deep-settings/AgentModeEditor.tsx` — single-mode editor card.
- **New**: `src/components/admin/deep-settings/AgentModeTemplates.ts` — preset library (HR, Customer Care, Sales, etc.).
- **`supabase/functions/whatsapp-messages/index.ts`** — replace static agent selection with dynamic mode loading + routing prompt builder.
- **`supabase/functions/create-company/index.ts`** — seed default modes per business_type.

### Verification

1. Open AI Deep Settings → Agents on ANZ → see existing Support/Sales/Boss as modes (migrated from old prompt fields), nothing visually lost.
2. Click "+ Add Mode" → pick "HR / Recruitment" template → save.
3. WhatsApp ANZ: *"Hi, I'd like to apply for a job"* → routed to HR mode → AI asks for name/role/CV instead of selling pans.
4. WhatsApp ANZ: *"how much is the cake stand?"* → still routed to Sales/Customer Care → answers normally.
5. Disable HR mode → applicant message falls back to default mode → no regression.

### Phased rollout (recommended)

- **Phase 1 (now)**: Build the table + UI + router. Migrate existing 3 agents into modes. Ship to ANZ + Omanut only.
- **Phase 2**: Add 4-5 industry templates and the "Suggest modes for my business" button.
- **Phase 3**: Per-mode analytics — which mode handled how many conversations, conversion per mode, escalation rate per mode.

