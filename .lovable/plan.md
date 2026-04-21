
## ANZ Configuration Deep-Fix — end-to-end audit + proper baseline

You've been patching ANZ symptom by symptom (timeouts, model swaps, affirmation handling, video search). The real issue is the **configuration baseline is wrong for ANZ's use case** — they're a high-volume retail catalog (cake stands, pans, kitchenware) with photos, prices, and stock that changes daily. The default config was built for service businesses (Omanut, Finch). That mismatch is why ANZ keeps breaking while the others mostly work.

This plan does a **full audit + reset** of ANZ specifically. Takes longer but ends the whack-a-mole.

### Phase 1 — Audit (read-only, ~10 min)

Pull the truth before changing anything:

1. **Current ANZ overrides** — `company_ai_overrides` row: model, tokens, tool rounds, timeout, enabled tools, system instructions, banned topics.
2. **Agent modes** — `company_agent_modes` rows: which modes exist, their prompts, trigger keywords, priorities.
3. **Catalog reality** — count of `company_media` (images vs videos), `payment_products`, BMS catalog size. Tells us if the AI has data to work with.
4. **Last 50 ANZ conversations** — group failures by type:
   - Timeout dead-ends (fallback_message sent, no follow-up)
   - Empty synthesis ("I've processed your request")
   - Wrong tool path (asked for photo, got nothing)
   - Affirmation misses ("yes" → silence)
   - Hallucinated prices/products
   - Router misclassification (sales → support)
5. **Edge function logs (last 24h)** — error patterns: `[RETRY-EXHAUSTED]`, tool timeouts, BMS failures, model errors.

Output: a one-page diagnosis showing the top 3 failure modes with counts.

### Phase 2 — Configuration reset (the real fix)

Based on audit, apply ANZ-specific overrides:

**A. Model + budget tuned for retail multi-tool flows**
- `primary_model`: keep GLM 4.7 (good tool discipline) OR fall back to `google/gemini-2.5-flash` if GLM is causing the empty-reply bug.
- `max_tool_rounds`: 4 → **6** (catalog browse needs check_stock + list_products + list_media + send_media + synthesis).
- `response_timeout_seconds`: 30 → **45**.
- `max_tokens`: 400 → **600** (room to list 3-5 products + photos + ask qualifying question).
- `routing_temperature`: 0.3 (consistent routing).
- `primary_temperature`: 0.4 (decisive, less rambling).

**B. System instructions rewritten for ANZ specifically**
Replace the generic instruction block with a tight ANZ-flavored one:
- "You sell kitchenware (cake stands, pans, baking tools). Always check live stock before quoting."
- "When customer asks about a product: check_stock → if in stock, quote price + offer photo → if they say yes/sure/ok, call list_media + send_media."
- "Never invent prices. Never say 'I've processed your request' — always state what you did or what's next."
- "Max 3 sentences per reply. Use *bold* for product names and prices."

**C. Enabled tools — prune to what ANZ actually uses**
Drop tools that are never called for ANZ (e.g. `create_scheduled_post`, digital product tools). Smaller tool list = better routing accuracy + faster responses.

**D. Agent modes — verify they fit retail**
- Keep: Sales, Customer Care, Boss.
- Tune Sales prompt: explicit "offer photo after price" pattern + autonomous checkout via `notify_boss` (ANZ is human-in-loop per memory).
- Tune Customer Care: handle "where's my order" / "can I exchange" — common ANZ asks.

### Phase 3 — Code-level safety nets (from previous "fix it" plan, kept)

These are still needed because no config alone fixes them:

1. **Real synthesis fallback** — when model returns empty after successful `list_media`/`list_products`/`check_stock`, build deterministic reply from tool results instead of "I've processed your request".
2. **Auto-retry on hard timeout** — single retry with halved tokens before sending dead-end fallback message.
3. **Affirmation handling** — already shipped, verify it's firing for ANZ.

### Phase 4 — Verification harness

Run these 8 scripted scenarios against ANZ's live config end-to-end:

1. *"do you have cake stands?"* → price + photo offer
2. *"yes"* (after offer) → photo arrives
3. *"show me all your pans with prices and pics"* → multi-tool roundtrip completes
4. *"how much is the blue 28cm pan?"* → exact price from check_stock, no hallucination
5. *"I want to buy 2"* → notify_boss fires, "Perfect choice, owner will confirm"
6. *"do you have video of the cake stand spinning?"* → video search hits, sends video
7. *"my order is late"* → routes to Customer Care, empathetic reply
8. Random *"yes"* with no prior offer → asks "yes to what?"

Pass = 7/8. Document failures, iterate.

### Phase 5 — Document what ANZ's config IS (so we stop drifting)

Save a memory: `mem://configurations/anz-baseline` — exact values for model, tokens, tool rounds, timeout, enabled tools, system instructions snippet. Next time something breaks, we diff against this baseline instead of guessing.

### Files touched

- DB: `company_ai_overrides` UPDATE for ANZ company_id (Phase 2A, 2C).
- DB: `company_agent_modes` UPDATE for ANZ Sales + Customer Care prompts (Phase 2B, 2D).
- `supabase/functions/whatsapp-messages/index.ts` — synthesis fallback + auto-retry (Phase 3).
- New memory file (Phase 5).
- No UI changes, no schema changes, no new tools.

### What I need from you before I start

One quick confirmation so Phase 2 doesn't go sideways:
