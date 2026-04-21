
## ANZ WhatsApp fixes — stop internal traces, preserve context, make retail flow deterministic

The screenshots show ANZ is still not production-ready. The worst failures are not “model intelligence” problems; they are orchestration bugs in `whatsapp-messages`.

### What is going wrong

1. **Internal tool traces are leaking to customers**
   - Replies like `[R3] search_media found 5 results, [R4] BMS check_stock completed...` are unacceptable.
   - That came from the fallback branch that was meant to prevent silence, but it exposed internal debug context.

2. **Successful tool results are being lost**
   - The fallback synthesis only reads the current `toolResults`, but `toolResults` gets reset during each tool round.
   - By the time synthesis runs, earlier product/media results are gone.
   - It also does not parse BMS `data`, so stock/product results are missed even when BMS succeeded.

3. **ANZ was configured for 6 tool rounds, but code caps it at 5**
   - Current code uses `Math.min(aiOverrides?.max_tool_rounds || 3, 5)`.
   - So the ANZ baseline says 6, but runtime silently cuts it to 5.

4. **“I want to buy 2” loses the previous product**
   - The AI had just quoted `Blue pans 28cm — K550`, but the next message “I want to buy 2” was handled as standalone.
   - It should infer: customer wants 2 of the last quoted product, then notify the owner.

5. **Support follow-up “yes” is being treated as meaningful**
   - After “my order is late”, the AI asks for order date/item.
   - Customer says “yes”.
   - That “yes” does not provide the missing detail, so the AI should ask again clearly, not send a fallback.

6. **Prompts conflict for ANZ**
   - ANZ is human-in-loop for sales, but the generic autonomous mode prompt still says “generate payment link”.
   - That contradiction is why the AI sometimes says it will provide a payment link.

7. **Media search works, but media sending is not guaranteed**
   - For “prices and pics”, `search_media` succeeded, but `send_media` did not always happen.
   - If customer explicitly asks for pics/videos and media search succeeds, the system should auto-send media if the model fails to call `send_media`.

---

## Implementation plan

### 1. Remove customer-facing internal fallback text

In `supabase/functions/whatsapp-messages/index.ts`:

- Delete the fallback that builds:
  - `Just checked on that for you — [R3] ...`
- Replace it with safe customer wording only:
  - Product found: list product names/prices.
  - Media found/sent: “Photos sent above.”
  - Nothing usable: “I’m still checking that for you — let me confirm with the owner.”

No internal tool names, round numbers, or debug strings should ever reach WhatsApp.

---

### 2. Preserve all tool results across rounds

Add a separate accumulator:

```ts
const allToolResults = [];
```

Every time a tool returns, push into both:
- `toolResults` for the next model round
- `allToolResults` for final synthesis

Then synthesis uses `allToolResults`, not only the last round.

Also update product extraction to parse:
- `payload.data`
- `payload.products`
- `payload.items`
- `payload.results`
- `payload.product`

This fixes BMS results being ignored.

---

### 3. Fix ANZ’s actual max tool rounds

Change:

```ts
Math.min(aiOverrides?.max_tool_rounds || 3, 5)
```

to allow ANZ’s configured 6 rounds:

```ts
Math.min(aiOverrides?.max_tool_rounds || 3, 8)
```

ANZ remains configured at 6.

---

### 4. Add deterministic auto-send for explicit media requests

If the customer asked for:
- pics
- pictures
- photos
- images
- videos
- clips

and `search_media` found results but `send_media` was not called, automatically send the top matching media.

Rules:
- If customer asked for video, send videos only.
- If customer asked for pictures/photos, send images only.
- Cap at 3 media files per reply for ANZ to avoid spam.
- Store `[Sent X/Y media]` in messages as it already does.

This makes “show me all your pans with prices and pics” reliable even if the model stops early.

---

### 5. Fix “I want to buy 2” after a quoted product

Before routing to the model, add deterministic context handling:

If latest user message is buy intent and does not name a product, inspect the last assistant message for a quoted product.

Example:

```text
Assistant: *Blue pans 28cm — K550* (4 in stock). Want to see a picture?
Customer: I want to buy 2
```

System should:
1. Extract product: `Blue pans 28cm`
2. Extract quantity: `2`
3. Call `notify_boss`
4. Reply:
   “Perfect choice — I’ve asked the owner to confirm 2 × *Blue pans 28cm* and send payment details shortly. 🙏”

No “which product are you interested in?” when the product was already named.

---

### 6. Fix meaningless “yes” in support flow

If the previous assistant message asked for a missing order detail like:
- order date
- item ordered
- receipt
- order number

and customer replies only “yes”, the system should not treat that as a valid answer.

Reply deterministically:

```text
Please send the order date or the item you ordered so I can check properly.
```

This prevents “Give me one moment…” dead-ends when the customer has not provided the needed detail.

---

### 7. Remove ANZ prompt contradictions

Update the prompt assembly so:

- `service_mode = autonomous` means the AI keeps responding instead of hard-handing off.
- `sales_mode = human_in_loop` means the AI never creates payment links or orders.

For ANZ, the final instruction should be:

```text
You may answer, browse catalog, check stock, send photos/videos, and collect intent.
You must not create payment links, record sales, or promise checkout.
When the customer wants to buy, notify the owner and say the owner will confirm payment details.
```

Remove the generic “generate payment link” instruction whenever `sales_mode = human_in_loop`.

---

### 8. Expand `notify_boss` schema for ANZ flows

The prompt asks for notifications like customer issue and purchase handoff, but the tool schema only allows:

```text
high_value, complaint, reservation_change, cancellation, vip_info
```

Add supported enum values:
- `purchase_handoff`
- `customer_issue`
- `order_followup`

Update the handler titles so owner notifications are clearer:
- `purchase_handoff` → “Purchase Request”
- `customer_issue` → “Customer Issue”
- `order_followup` → “Order Follow-up”

---

### 9. Improve BMS product matching

In `bms-agent` and the local BMS fallback inside `whatsapp-messages`:

- Normalize plural/singular terms:
  - `pan` / `pans`
  - `stand` / `stands`
- Match by tokens, not exact phrase order.

So:

```text
blue 28cm pan
```

matches:

```text
Blue pans 28cm
```

This avoids BMS returning the full catalog and the AI guessing from unrelated rows.

---

### 10. Re-run the 8 ANZ tests

After deploying the backend function and DB prompt/schema updates, verify:

1. “do you have cake stands?” → price + photo offer.
2. “yes” → actual cake stand photo sent.
3. “show me all your pans with prices and pics” → product summary + media, no internal traces.
4. “how much is the blue 28cm pan?” → exact BMS price/stock.
5. “I want to buy 2” → owner notified for 2 × blue 28cm pan.
6. “do you have video of the cake stand spinning?” → videos sent.
7. “my order is late” → asks for order date/item.
8. “yes” after that → asks again for order date/item, no fallback.

Pass criteria:
- No `[R3]`, tool names, or debug traces in customer messages.
- No payment-link promise for ANZ.
- No “which product?” when previous product is obvious.
- No dead-end “Give me one moment” unless the system is truly failing.
