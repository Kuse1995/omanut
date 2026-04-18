

User wants `service_mode` ("autonomous" | "human_first" | "hybrid") in `company_ai_overrides` to actually change AI behavior in the WhatsApp flow. ANZ is a paying client Monday — this is real.

Let me explore what's already wired up before planning.
<lov-tool-use id="toolu_vrtx_0129Z1BSoMLsTBLGGfgtJedN" name="code--search_files" integration-id="code" data="{\"query\": \"service_mode\", \"include_patterns\": \"supabase/functions/**/*.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01S2rQGHGnrY6cRxyWztcYYz" name="code--search_files" integration-id="code" data="{\"query\": \"is_paused_for_human\", \"include_patterns\": \"supabase/functions/**/*.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_014CbxkegxgYWhyQCgNJ3iNb" name="code--search_files" integration-id="code" data="{\"query\": \"human_takeover|takeover_at|active_agent\", \"include_patterns\": \"supabase/functions/whatsapp-messages/**/*.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_015bF3oQco9Fy19rZZMZGLsx" name="code--search_files" integration-id="code" data="{\"query\": \"service_mode\", \"include_patterns\": \"supabase/functions/**/*.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01X66Q1PZxqk94s1RTFxsXQE" name="code--search_files" integration-id="code" data="{\"query\": \"is_paused_for_human\", \"include_patterns\": \"supabase/functions/**/*.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01FqnbkubXQ9tEU3rhG5uqfd" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/whatsapp-messages/index.ts\", \"lines\": \"1440-1700\"}">
</lov-tool-use>
I have enough to plan. Let me look briefly at how `messageComplexity` is set and where the system prompt is composed for hybrid context.
<lov-tool-use id="toolu_vrtx_01Bs9CPhu5G7QJ3Cx9b6xgNi" name="code--search_files" integration-id="code" data="{\"include_patterns\": \"supabase/functions/whatsapp-messages/index.ts\", \"query\": \"messageComplexity|complexity_threshold\"}">
</lov-tool-use>
I have enough. Now the plan.

<lov-plan>

## What's already there vs. what's missing

`whatsapp-messages/index.ts` already reads `service_mode` (line 1453) and has a queue-for-human path (lines 1456–1584). But it doesn't match the spec:

| Requirement | Current behavior | Gap |
|---|---|---|
| Autonomous: AI handles everything, no handoff | `human_takeover: false` is set when router picks sales/support ✅, but boss-agent routing still pauses for human | Boss-routing should NOT auto-pause in autonomous mode (only `notify_boss` for severe complaints) |
| Human-first: AI greets + always hands off | Queues to human only on first complex message; simple greetings still get full AI replies | Should ALWAYS queue (any message) |
| Hybrid: AI handles simple, hands off on intent triggers | Only triggers on `messageComplexity === 'complex'`, which is keyword-based on greeting patterns — does not detect "I want to buy", "ready to pay", "5+ items", "send your number", complaints | Need explicit hybrid handoff trigger detector |
| Handoff message wording: "Let me connect you with the team..." | Generic ack: "Your request has been logged as TKT-..." | Replace with spec wording in hybrid/human_first |
| `notify_boss` with full context on handoff | Only sent when router picks `boss` agent | Must fire on every hybrid/human_first handoff with structured context (name, phone, stage, collected info) |
| AI system prompt segment for hybrid mode | None | Inject the hybrid handoff instructions into the system prompt when `service_mode === 'hybrid'` |

## Plan

### 1. Add a hybrid handoff trigger detector
New helper `detectHybridHandoffTrigger(userMessage, messageHistory)` returning `{ triggered: bool, reason: string, stage: 'browsing'|'interested'|'ready_to_buy'|'complaint'|'bulk'|'human_request' }`. Pattern-matches the 6 spec triggers:
- buy intent: `/\b(i\s*want\s+to\s+buy|i'?ll?\s+take\s+it|ready\s+to\s+(pay|order|buy)|let'?s\s+do\s+it)\b/i`
- payment talk: `/\b(payment|pay\s+(now|by|with)|momo|account\s+(number|details)|how\s+do\s+i\s+pay)\b/i`
- partial/custom: `/\b(partial|installment|deposit|discount|negotiate|special\s+price)\b/i`
- human request: `/\b(call\s+me|your\s+number|speak\s+to\s+(someone|a\s+person|human)|talk\s+to)\b/i`
- complaint: `/\b(complain|complaint|problem|issue|not\s+working|broken|disappointed|unhappy|refund)\b/i`
- bulk: parse quantities, trigger if any single-item count ≥ 5

### 2. Rewrite the service-mode branch (around line 1452–1584)

```text
serviceMode = aiOverrides?.service_mode || 'autonomous'

if serviceMode === 'human_first':
    → ALWAYS hand off (every message)
    → use spec ack: "Let me connect you with the team — someone will be with you shortly via WhatsApp. 📱"
    → set is_paused_for_human + human_takeover + active_agent='human_queue'
    → notify_boss with structured context
    → return

if serviceMode === 'hybrid':
    trigger = detectHybridHandoffTrigger(userMessage, messageHistory)
    if trigger.triggered:
        → send spec ack
        → set is_paused_for_human + human_takeover + active_agent='human_queue'
        → notify_boss with stage + collected info
        → return
    else:
        → fall through to normal AI processing (with hybrid system-prompt segment injected)

if serviceMode === 'autonomous':
    → fall through, BUT skip the boss-routing auto-pause (boss agent should still answer; only severe-complaint detection fires notify_boss without pausing)
```

### 3. Inject hybrid instructions into the system prompt

In the agent prompt builder (where `sales_agent_prompt` / `support_agent_prompt` is composed, around line 2200+), append the spec's `== HYBRID MODE: WHEN TO HAND OFF ==` block when `serviceMode === 'hybrid'`. This is the safety net for triggers the regex misses.

### 4. Autonomous mode: stop auto-pausing on boss routing
In the router branch (lines 1655–1679), gate the `selectedAgent === 'boss'` pause behind `serviceMode !== 'autonomous'`. In autonomous, route to boss agent for context but keep `is_paused_for_human: false` and let the AI continue replying. Severe complaints still call `sendBossHandoffNotification` for awareness.

### 5. notify_boss handoff context
Build a structured payload from existing `generateConversationSummary` + `client_information` table:
```text
{
  customer_name, customer_phone,
  asking_about: <last user message excerpt>,
  stage: trigger.stage,
  collected_info: { name, address, payment_method } from client_information,
  trigger_reason: trigger.reason
}
```
Pass to `sendBossHandoffNotification` (already exists, extend signature).

### 6. Files touched
- `supabase/functions/whatsapp-messages/index.ts` — only file. Detector helper at top, service-mode branch rewritten, system-prompt injection, boss-routing gate.

No DB migrations. No new tables. No new edge functions.

### Verification (matches user's testing checklist)

1. Set ANZ `service_mode='autonomous'` → "I want to buy the K350 one" → AI completes sale, no pause flag set, boss may get notify but conversation stays AI-driven.
2. Set `service_mode='human_first'` → "how much is the blue pan" → spec ack sent, `is_paused_for_human=true`, ticket created, boss notified.
3. Set `service_mode='hybrid'` → "I want to buy" → spec ack sent, `is_paused_for_human=true`, boss notified with stage=`ready_to_buy`.
4. Set `service_mode='hybrid'` → "do you have the blue pan in stock" → AI answers normally, no pause.
5. Set `service_mode='hybrid'` → "your phone is broken and I want a refund" → spec ack, paused, stage=`complaint`.
6. Confirm in DB: `select is_paused_for_human, human_takeover, active_agent from conversations where id=...` reflects state after each test.
7. Confirm Abraham receives WhatsApp with structured context for tests 2/3/5.

