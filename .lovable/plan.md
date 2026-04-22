

## Why GreenGrid keeps replying "Give me one moment…"

### What's actually happening (timeline from the DB)

```text
22:08  customer:  Hello
22:08  AI:        Welcome to GreenGrid Energy…
22:09  customer:  Can I see some pics of solar panels you've installed
22:09  AI:        Give me one moment 🙏        ← stall #1
22:11  AI:        Give me one moment 🙏        ← stall #2 (watchdog re-run)
22:22  AI:        Give me one moment 🙏        ← stall #3 (watchdog re-run)
22:32  AI:        I'm having trouble pulling that up… owner notified  ← watchdog escalation
```

### Root cause

GreenGrid's `enabled_tools` list is the **ANZ baseline** we seeded on every new company yesterday:

```
[lookup_product, list_media, send_media, notify_boss,
 create_scheduled_post, check_stock, list_products, check_customer,
 record_sale, generate_payment_link, bms_list_products, bms_check_stock]
```

But `whatsapp-messages/index.ts` only defines tools named **`search_media`** + `send_media` for media flows — **not `list_media`**. So when the customer asks for solar panel photos:

1. The AI tries to satisfy the request, but `search_media` is **not in the enabled list** → it can't look up media.
2. Every system-prompt branch that mentions media (lines 2322-2324, 2465) tells the AI: *"You MUST call `search_media` first, NEVER fabricate URLs."* With that tool absent, the safest output the model can produce is the stalling fallback.
3. `pending-promise-watchdog` sees the "one moment" message, re-invokes `whatsapp-messages` with `isPromiseFulfillment=true` (which says *"DO NOT stall, use your tools"*), but the tool list hasn't changed, so it stalls again.
4. After two re-runs the watchdog hits `MAX_FULFILLMENTS_PER_HOUR`, sends the "I'm having trouble pulling that up" handoff, pauses the conversation, and pings the owner.

So GreenGrid (and every other company seeded yesterday) is structurally unable to send media on WhatsApp because its tool config references a tool name that the runtime doesn't know about.

Secondary contributor: GreenGrid has 12 rows in `company_media`, but none of them have embeddings or descriptions tied to "solar panels" yet, so even with `search_media` enabled the vector search would fall through to the latest-media fallback. Fixing the tool name unblocks that path; tagging/captioning media is a separate content-quality task.

### Fix

**1. Replace `list_media` with `search_media` in the baseline tool set**
Update the seed defaults in `company_ai_overrides` (the `trg_seed_company_ai_overrides` trigger) so new companies get the actual runtime tool name. One-shot migration to backfill all existing rows where `enabled_tools` contains `'list_media'` → swap it for `'search_media'`. Affects: GreenGrid, Finch, ANZ, Omanut, North Park, E-Library, Art of Intelligence — every company seeded with the baseline.

**2. Drop BMS tools from companies that have no BMS connection**
For companies whose `bms_connections` row is missing or `is_active=false` (GreenGrid, North Park, E-Library, Art of Intelligence), strip `check_stock`, `list_products`, `record_sale`, `generate_payment_link`, `bms_list_products`, `bms_check_stock`, `lookup_product` from `enabled_tools`. Otherwise the AI still sees them in the schema, calls `check_stock` for "solar panels", `bms-agent` returns `no_connection`, and the model falls back to "one moment" again on the next round.

**3. Tighten the watchdog so it doesn't repeat the same stall 3× before escalating**
In `pending-promise-watchdog/index.ts`, when `wasFulfillmentOutput === true` (the previous reply was already a watchdog re-run that re-stalled), escalate **immediately** instead of allowing a second re-run. Already in the code at line 118 — but the message at 22:11 was the first watchdog attempt, so its `message_metadata.promise_fulfillment` flag was never set on insert. Add `message_metadata: { promise_fulfillment: true }` to the assistant message persisted by `whatsapp-messages` whenever `isPromiseFulfillment === true` was passed in, so the next watchdog tick sees the flag and escalates after 1 retry instead of 2.

**4. Sync the seed with reality going forward**
Update `mem://configurations/anz-baseline` and `mem://architecture/company-ai-overrides-defaults` to use `search_media` (not `list_media`), and to note that BMS tools should only be seeded for companies with an active `bms_connections` row.

### Files

- **DB migration** —
  - Update the `trg_seed_company_ai_overrides` function/default constant: `list_media` → `search_media`.
  - Backfill: `UPDATE company_ai_overrides SET enabled_tools = array_replace(enabled_tools, 'list_media', 'search_media')`.
  - Backfill: for company_ids without an active `bms_connections` row, remove BMS tool names from `enabled_tools`.
- **`supabase/functions/whatsapp-messages/index.ts`** — when persisting the assistant reply during an `isPromiseFulfillment` invocation, write `message_metadata: { promise_fulfillment: true }` so the watchdog can detect a re-stall.
- **`mem://configurations/anz-baseline.md`** + **`mem://architecture/company-ai-overrides-defaults.md`** — correct the tool list.

### Validation

1. From `+260972064502` to GreenGrid: "Can I see some pics of solar panels you've installed" → AI calls `search_media`, sends one of the 12 GreenGrid media files (best vector match, or latest image as fallback), single reply, no "one moment".
2. Same prompt to Finch (which has BMS) → still works for media; BMS tools still available for stock questions.
3. Same prompt to North Park (no BMS, no relevant media) → AI does **not** loop on `check_stock`; either returns the latest image or politely says it doesn't have photos, and falls into a single notify_boss handoff if needed.
4. Force a stall (temporarily remove `search_media` from one test company) → watchdog escalates after **1** retry, not 2.
5. Tail `whatsapp-messages` logs → no `[BMS-AGENT] no_connection` entries for tenants without BMS.

No UI changes, no auth/RLS changes, no BMS code changes.

