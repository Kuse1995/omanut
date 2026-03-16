

# Fix: Customer Quotation Request Failing at Tool Loop

## Root Cause Analysis

The customer asked "Can I have a quotation for 3 lifestraw families". The AI correctly called `check_stock` first (got back 90 units at K730). Then in the **tool loop Round 1**, the follow-up AI call returned **400**, causing a generic fallback message. The customer never got a quotation.

**Two bugs found:**

### Bug 1: 400 Error from Gemini — Polluted `tool_calls` Object
When the assistant message is added back to the conversation (line 3994), it passes the raw `currentToolCalls` array which includes Gemini's internal `extra_content.google.thought_signature` field. When this is sent back to the API in the next round, the model rejects it with 400.

**Fix:** Strip `extra_content` from tool calls before passing them back into the message history.

### Bug 2: Tool Loop Only Handles 3 Tools in Subsequent Rounds
The tool loop (lines 4061-4093) only dispatches `check_stock`, `record_sale`, `generate_payment_link` in rounds 2+. All other BMS tools (including `create_quotation`, `create_invoice`, `create_order`, etc.) fall through to a generic "Tool executed" stub that doesn't actually call BMS. Even if Bug 1 were fixed, the quotation would never be created in round 2+.

**Fix:** Route all BMS tools through `bms-agent` in the tool loop, not just 3 checkout tools. Also handle `search_media`, `search_knowledge`, `search_past_conversations`, `send_media`, `lookup_product`, and other semantic search tools.

## Changes

### `supabase/functions/whatsapp-messages/index.ts`

1. **Strip `extra_content` from tool calls** before adding them back to messages in the tool loop (around line 3994):
```typescript
const cleanToolCalls = currentToolCalls?.map(tc => ({
  id: tc.id,
  type: tc.type,
  function: tc.function,
}));
```

2. **Expand tool loop dispatch** (lines 4061-4093) to handle ALL BMS tools, not just 3. Replace the hardcoded `['check_stock', 'record_sale', 'generate_payment_link']` check with the full BMS tool set and reuse the same param-mapping logic from the first-round handler. Also handle semantic search tools (`search_media`, `search_knowledge`, `search_past_conversations`) and the auto-PDF delivery for `create_quotation`/`create_invoice`.

3. **Also strip `extra_content`** from the first-round tool calls stored in `currentToolCalls` (line 3974).

