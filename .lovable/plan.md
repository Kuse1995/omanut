

## Auto-sync BMS data instead of manual pull

Right now `BmsSyncPanel` only fires when a user clicks "Sync from BMS" — it pulls products, stock, and sales, formats them, and writes them into the company's Knowledge Base wrapped in `<!-- BMS_SYNC_START -->` markers. Nothing keeps that text in sync after a sale on the BMS side.

You're right — the AI should never quote stale stock. The fix is to **stop relying on the cached KB snapshot for live data and pull it on-demand at conversation time**, plus a low-frequency safety-net background sync.

### The real problem with the current design

Even if we cron the existing sync every 5 minutes, the AI still answers from a **frozen text blob** in the Knowledge Base. Between syncs it will always be wrong. The KB is the wrong place for stock numbers — it should hold *static* business facts (policies, hours, return policy), not live inventory.

Live data already has a path: the `list_products` and `check_stock` BMS tools call the bridge in real time. So the right architecture is:

1. **Live data** (stock, prices, current orders) → tools only, never the KB.
2. **Catalog snapshot** (product names, categories, photos for the AI to "know what exists") → background-synced, with timestamp and short TTL.
3. **Manual sync button** → kept as an override for when a boss wants to force-refresh after a big change.

### Fix

#### 1. Background auto-sync (cron)
- New cron: `bms-auto-sync-cron` runs every 15 minutes.
- For every company with an active `bms_connections` row, call the existing `bms-training-sync` function.
- Updates only the BMS-marked block in `quick_reference_info`. Static KB content the user wrote stays untouched (already supported by the START/END markers).
- Skip companies where the last sync succeeded < 10 minutes ago (avoid stampedes if cron fires twice).

#### 2. Real-time invalidation via BMS callback
The Omanut BMS bridge already has a `bms-callback` edge function. Extend it to accept a `stock_changed` / `sale_recorded` event:
- Bridge POSTs `{ event: "sale_recorded", tenant_id, company_id, products: [...] }` whenever a transaction completes.
- `bms-callback` triggers `bms-training-sync` immediately for that company so KB metadata + auto-linked media reflect the change within seconds.
- If the bridge can't push events yet, the 15-min cron is the fallback.

#### 3. Stop using cached stock numbers in the KB
- `bms-training-sync` keeps the **product catalog + low-stock alerts** in the KB block (helpful for the AI to know what exists and what's running low *for guidance*) but adds a clear instruction header:
  > "STOCK NUMBERS BELOW ARE A SNAPSHOT. Always call `check_stock` or `list_products` before quoting availability to a customer."
- This is already the system's intent (see `mem://features/bms-data-priority-messaging`) but the prompt doesn't currently say it loud enough — the AI was treating the KB snapshot as truth.
- Add a one-line reinforcement to the global system prompt builder in `whatsapp-messages/index.ts` so it's enforced for every company with a BMS connection.

#### 4. UI updates in `BmsSyncPanel`
- Show last auto-sync timestamp (`Last synced 4 min ago`) above the manual sync button.
- Add a small "Auto-sync: every 15 min + on sale" status pill so the boss can see it's live.
- Manual sync remains as a "Force refresh now" override.

#### 5. Auto-link media on every sync (already partially done)
The current sync auto-links unlinked media to BMS products by name match. Move this into a shared helper so both the cron and the callback path use it. No new logic, just deduplication.

### Files

- New: `supabase/functions/bms-auto-sync-cron/index.ts` — iterates companies with active `bms_connections`, calls `bms-training-sync` per company, respects 10-min cooldown.
- DB migration — `cron.schedule('bms-auto-sync', '*/15 * * * *', ...)` invoking the new function; add `last_bms_sync_at timestamptz` to `bms_connections`.
- Edit: `supabase/functions/bms-callback/index.ts` — handle `sale_recorded` / `stock_changed` events and trigger `bms-training-sync` per company.
- Edit: `supabase/functions/bms-training-sync/index.ts` — write `last_bms_sync_at`, prepend the "snapshot only — call tools for live stock" header to the KB block.
- Edit: `supabase/functions/whatsapp-messages/index.ts` — add a one-line reinforcement to the system prompt when the company has a BMS connection.
- Edit: `src/components/admin/BmsSyncPanel.tsx` — show last auto-sync time + auto-sync status pill.
- Memory: `mem://features/bms-auto-sync.md` — record the new behavior (15-min cron + sale_recorded webhook + tool-first stock policy).

### Validation

1. Trigger a sale on the BMS for a connected company → within seconds, `quick_reference_info` BMS block updates with new stock numbers.
2. With auto-sync disabled (force), a customer asks "do you have X?" → AI calls `check_stock` (live), not the KB number.
3. Cron runs every 15 min; second-run-within-10-min skipped per cooldown.
4. `BmsSyncPanel` shows "Last synced 2 min ago — auto-sync active".

No schema-breaking changes, no new tools for the AI, no UI redesign.

