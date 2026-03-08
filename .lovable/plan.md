
Goal: fix 3 production issues together:
1) payment-link requests still trigger handover,
2) checkout toolchain does not complete reliably,
3) product images are inaccurate and must stay reference-locked.

What I found in current codebase
- Handover is happening before checkout starts:
  - `routeToAgent()` still classifies payment keywords as `boss` and fallback hard-routes `pay|payment|...` to `boss`.
  - Confirmed in live data: `agent_performance` shows `agent_type='boss'` for “send a payment link”.
- Checkout tools are not consistently available:
  - `company_ai_overrides.enabled_tools` currently contains only:
    `create_reservation, get_date_info, check_availability, send_media, lookup_product`
  - So `check_stock`, `record_sale`, `generate_payment_link` are often excluded at runtime.
- Prompt conflict still exists:
  - System instructions still include legacy `request_payment` flow in multiple places, conflicting with the new BMS + payment-link flow.
- Tool loop is single-pass:
  - After first tool execution, second AI call is made **without tools**, so it cannot continue multi-step checkout if the model didn’t call all tools in round 1.
- Image accuracy issue root cause:
  - Product matcher relies mostly on filename/description/tags; current product media has generic descriptions and empty tags.
  - If no match, code falls back to text-only generation, which breaks branding consistency.

Implementation plan

1) Remove payment-from-router handover path (hard fix)
- File: `supabase/functions/whatsapp-messages/index.ts`
- Update `routeToAgent` prompt:
  - `BOSS` should be only true critical escalation (abuse/legal/fraud/threat/safety), not standard payment/purchase.
- Update fallback classifier:
  - payment/purchase keywords route to `sales`, not `boss`.
- Add runtime safety override:
  - if router returns `boss` but message is standard purchase/payment intent, force `selectedAgent='sales'` and log override reason.

2) Guarantee checkout tools are always enabled where needed
- File: `supabase/functions/whatsapp-messages/index.ts`
- In tool filtering:
  - For non-school and `payments_disabled !== true`, auto-merge mandatory checkout tools into enabled set:
    - `check_stock`, `record_sale`, `generate_payment_link` (and keep `lookup_product`).
  - Keep school restrictions intact.
- This avoids dependence on stale `enabled_tools` arrays in DB.

3) Replace conflicting payment instructions with one authoritative checkout policy
- File: `supabase/functions/whatsapp-messages/index.ts`
- Remove/replace legacy `request_payment` guidance sections in the main system prompt block.
- Keep one strict flow only:
  - check stock -> record sale -> generate payment link -> send link.
- Keep explicit “no escalation for normal purchase/payment.”

4) Make tool orchestration multi-round (so chain can complete)
- File: `supabase/functions/whatsapp-messages/index.ts`
- Refactor tool handling into iterative loop using configured `max_tool_rounds` (with safe cap).
- Each round:
  - call model with tools,
  - execute tool calls,
  - append tool results,
  - call model again **with tools still available** until no more tool calls or round limit reached.
- This enables reliable autonomous chaining (instead of hoping all 3 tools are called in one shot).

5) Normalize BMS tool outputs for model readability + deterministic payment-link fallback
- File: `supabase/functions/whatsapp-messages/index.ts`
- For `check_stock`, `record_sale`, `generate_payment_link`:
  - pass `company_id` in bridge payload for consistency with other integrations.
  - normalize returned tool JSON (flat keys like `success`, `receipt_number`, `payment_url`, `amount`, `currency`).
- Add final response guard:
  - if checkout tools succeeded and `payment_url` exists, ensure customer reply includes the link even if model reply is vague.

6) Enforce strict reference-only generation for branding
- File: `supabase/functions/whatsapp-image-gen/index.ts`
- For `messageType='generate'`:
  - remove text-only fallback when product matching fails.
  - if no confident product match -> return a clear instruction instead of generating:
    - ask boss to view/select product references first (no generic generation).
- Upgrade matcher quality:
  - use multimodal product selection (candidate images + prompt + BMS match context), returning `{selected_id, confidence}`.
  - require confidence threshold; below threshold => no generation.
  - remove naive keyword fallback that currently picks wrong items.
- Ensure output always uses selected uploaded reference image as anchor when generation proceeds.

7) Tighten boss workflow around product references
- File: `supabase/functions/boss-chat/index.ts`
- Keep `list_product_images`, but update guidance so low-confidence generation replies explicitly direct boss to “show product images” first.
- Ensure messaging states generation is blocked until a reference match is confident (branding lock).

Technical details (concise)
- No schema change required for core fix.
- Existing secrets already present (`BMS_API_SECRET`, `GEMINI_API_KEY`).
- Security model unchanged (service-role in backend functions only).
- Preserve school/payment-disabled business guardrails.

Validation plan (end-to-end)
1) Payment flow test (customer):
   - “I want to buy one LifeStraw Family, send payment link”
   - Expect: no handover message, no pause/human_takeover, and reply contains valid Lenco `payment_url`.
2) Toolchain test:
   - Confirm logs show `check_stock` -> `record_sale` -> `generate_payment_link` sequence (may be multi-round).
3) Data/state test:
   - `conversations.active_agent` stays `sales`; `is_paused_for_human=false`.
4) Image strictness test:
   - Ask for product image with ambiguous prompt.
   - Expect: if uncertain, no generation; assistant asks to use reference list.
5) Image accuracy test:
   - Ask for known uploaded product.
   - Expect: generation is anchored to selected reference only (no generic substitute).
