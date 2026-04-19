
Add a "Sales Mode" toggle card to `CompanySettingsPanel.tsx`, right under the existing "Service Mode" card. It writes to `companies.metadata.sales_mode` (the same JSONB field the edge function already reads), so no DB schema change and no edge-function change needed.

**Two options, presented as a radio-card pair (matches existing Service Mode UI):**

1. **Autonomous Sales** — AI closes sales end-to-end (calls `record_sale` + `generate_payment_link`). Best for digital products and self-serve checkout.
2. **Human-in-the-Loop** — AI browses, answers, checks stock, then hands off to the boss when buy intent is detected. Best for businesses where the owner wants to personally confirm every order.

**Implementation**

- New card titled "Sales Mode" with `Bot` or `Users` icon, placed after the Service Mode card (around line 201).
- Reads `selectedCompany.metadata?.sales_mode` (defaults to `'autonomous'`).
- On click, merges new value into existing metadata JSONB:
  ```ts
  await supabase.from('companies')
    .update({ metadata: { ...(selectedCompany.metadata || {}), sales_mode: newMode } })
    .eq('id', selectedCompany.id);
  refreshCompanies();
  ```
- Toast confirmation, then `refreshCompanies()` so `selectedCompany` reflects the change.
- A small inline note below the toggle when `human_in_loop` is selected, reminding the admin to also remove `record_sale` / `generate_payment_link` from `enabled_tools` in AI Deep Settings (or we can do this automatically — see below).

**Bonus auto-sync (recommended, keeps config consistent)**

When switching modes, also update `company_ai_overrides.enabled_tools`:
- → `human_in_loop`: strip `record_sale`, `generate_payment_link`, `check_customer` from the array, set `max_tool_rounds = 3`.
- → `autonomous`: add those three back, set `max_tool_rounds = 4`.

This prevents the contradictory state where metadata says "human-in-loop" but the AI still has checkout tools enabled. Done in the same mutation.

**Files**

- `src/components/admin/CompanySettingsPanel.tsx` — add Sales Mode card + mutation (~50 lines).

**Verification**

1. Open a company in admin → Settings → see new "Sales Mode" card with current mode highlighted.
2. Click "Human-in-the-Loop" on Omanut → toast confirms, `companies.metadata.sales_mode` = `human_in_loop`, `enabled_tools` no longer has `record_sale`.
3. Send "I want to buy X" via WhatsApp → AI calls `notify_boss`, no payment link.
4. Click "Autonomous" → tools restored, AI closes sales again.
5. ANZ already shows "Human-in-the-Loop" as active (set last session) — no change needed, just confirms the UI reflects DB state.

No migrations, no edge function changes — pure UI wiring on top of logic that already works.
