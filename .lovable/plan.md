
The user wants ANZ's AI to NOT autonomously close sales. Instead, when a customer shows buying intent, the AI should hand off to a human (the boss) rather than running checkout itself. Omanut keeps autonomous checkout (or doesn't need it either since it's a tech/services company).

This reverses part of what we just did. Let me think about what actually needs to change:

**Current ANZ state (after last fix):**
- `enabled_tools` includes `record_sale`, `generate_payment_link`, `check_customer`, `check_stock` — full checkout chain
- `max_tool_rounds = 4` (bumped for checkout)
- System prompt likely tells AI to autonomously close per the autonomous-checkout-system memory

**What ANZ actually needs (human-in-the-loop):**
- AI can browse catalog, answer questions, check stock, send media
- When customer expresses buy intent ("I want to buy", "how do I pay", "I'll take it") → AI calls `notify_boss` with a clean handoff summary, tells customer "Let me get the owner to finalize this for you, one moment 🙏", and stops
- Boss takes over via the existing takeover/boss-chat channel
- No `record_sale`, no `generate_payment_link` — those tools get removed from ANZ

**Changes needed:**

1. **ANZ `company_ai_overrides` update**:
   - Remove from `enabled_tools`: `record_sale`, `generate_payment_link`, `check_customer`
   - Keep: `check_stock`, `bms_list_products`, `lookup_product`, `list_media`, `send_media`, `notify_boss`, `create_scheduled_post`
   - `max_tool_rounds` can drop back to 3 (browse + check_stock + notify_boss)
   - Add a `human_handoff_mode` or similar flag — OR just bake it into system instructions

2. **System instructions for ANZ**: Add explicit rule:
   > "HUMAN-IN-THE-LOOP MODE: You DO NOT process payments or create orders. When a customer expresses buy intent (wants to purchase, asks how to pay, says 'I'll take it', confirms an item), call `notify_boss` with a summary (customer name, item, qty, price), then reply: 'Perfect choice! Let me get the owner to confirm and send you the payment details — one moment 🙏'. Then STOP. Do not call record_sale or generate_payment_link — these are not available to you."

3. **Code: respect the per-company autonomy flag in `whatsapp-messages/index.ts`**:
   - The autonomous checkout floor-bump logic (the one we just added at line 4636-4646) should NOT bump tool rounds for companies without the checkout tools enabled. Already handled by `hasCheckoutTools` check, so this is fine — but I should verify.
   - The autonomous-checkout authority text injected into the prompt should be SKIPPED for companies without `record_sale` enabled. Need to find where that's added.

4. **New column (optional but cleaner)**: `companies.sales_mode` enum: `autonomous` | `human_in_loop`. Default `autonomous`. ANZ = `human_in_loop`. Then code branches cleanly instead of inferring from tool list. But this is bigger scope — I'll offer it as Bonus.

5. **Memory update**: Add a memory note documenting that sales mode is per-company and how to configure it.

I have enough context. Plan is small and clear — no need to ask questions.
