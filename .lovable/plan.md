

## Final ANZ fix — make the buy-intent shortcut actually fire

The 8-test rerun shows **7/8 passing**. Only Test #5 still fails: "I want to buy 2" got the generic "which product are you interested in? I can provide a payment link" reply instead of triggering the deterministic purchase handoff.

### Root cause

The deterministic buy-intent shortcut in `whatsapp-messages/index.ts` (line 3197) extracts the previously quoted product with this regex:

```
/\*([^*\n]{2,80}?)\*\s*[—\-–:]\s*[A-Za-z]{0,3}\s*\d/
```

It assumes the AI formats prices like `*Blue pan* — K550` (price OUTSIDE the asterisks).

But ANZ actually replies `*Blue 28cm pan — K550*` (price INSIDE the asterisks — single bold span containing both name and price). The regex never matches → `lastQuotedProduct = null` → shortcut skipped → request falls through to the model, which has no product context and asks "which product?".

Plus, when the shortcut fails the model still mentions "payment link" — meaning the human-in-loop instruction isn't reaching the model in this code path (likely because the prompt section that forbids payment links is conditional on something not being set here).

### Fix

#### 1. Rewrite `lastQuotedProduct` extraction to handle real formats

Replace the single-pattern regex (line 3193-3201) with a layered matcher that tries, in order:

1. **Bold span containing price**: `*Blue 28cm pan — K550*` → split on the dash, take left side.
   - Regex: `/\*([^*\n]{2,80})\*/g`, then for each match check if it contains a price token (`K\d+|ZMW\s*\d+|\$\d+`) and split on `—|–|-|:|@` to grab the name half.
2. **Bold name then price outside**: `*Blue pan* — K550` (current pattern, keep as fallback).
3. **Markdown double-bold**: `**Blue pan**` followed within 30 chars by a price.
4. **Plain quoted**: `"Blue pan"` followed by a price.

Pick the LAST occurrence in the assistant message (most recently quoted product wins when several are listed).

Add a hard sanity check: if extracted name is < 3 chars, contains only digits, or matches a stop-list (`stock`, `price`, `photo`, `picture`, `K\d+`), discard it.

#### 2. Loosen the buy-intent gate

Currently: `isBuyIntent && !productAlreadyNamed && lastQuotedProduct && human_in_loop`.

The `!productAlreadyNamed` guard rejects "I want to buy 2 pans" because "pan" is in `namesProductHints`. But that's actually fine — they DID name a product type, and we should still notify the boss. Change the rule to:

- Fire the shortcut if `isBuyIntent && lastQuotedProduct && human_in_loop`, regardless of `productAlreadyNamed`.
- If `productAlreadyNamed` is true AND the quoted product matches the named hint (e.g. "buy 2 pans" + last quoted "Blue pans 28cm"), use the quoted product (more specific).
- If named hint does NOT overlap the quoted product (e.g. user says "buy a stand" but last quoted was a pan), skip the shortcut and let the AI handle disambiguation.

#### 3. Stop "payment link" leakage for human_in_loop

Even when the shortcut fails, the model must never promise payment links for ANZ. Audit the prompt-assembly section (around line 2080-2100) and confirm the "MUST NOT create payment links" clause is appended for ALL routing paths — not just the autonomous-mode branch. Add it unconditionally to the system prompt when `sales_mode === 'human_in_loop'`, placed AFTER the agent personality block so it can't be overridden.

#### 4. Add observability

When the shortcut considers firing, log all decision inputs:
```
[DETERMINISTIC-BUY] eval { isBuyIntent, productAlreadyNamed, lastQuotedProduct, salesMode, lastAssistantSnippet }
```
So next time something fails we can see exactly why in 10 seconds instead of guessing.

#### 5. Re-run only the failing test

After deploy, send "I want to buy 2" to ANZ following the same product-quote turn. Expected reply:

> "Perfect choice — I've asked the owner to confirm 2 × *Blue 28cm pan* and send payment details shortly. 🙏"

And a `purchase_handoff` row should appear in `boss_conversations`.

### Files touched

- `supabase/functions/whatsapp-messages/index.ts` — new `extractQuotedProduct()` helper (replaces the inline regex), loosened gate, unconditional human-in-loop guard rail, decision logging.
- Memory `mem://configurations/anz-baseline.md` — append note about the bold-format quirk so future drift doesn't reintroduce the bug.

No DB changes, no schema changes, no new tools.

