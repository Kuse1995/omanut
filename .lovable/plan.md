

## Two fixes: replicate ANZ baseline to all companies + route boss image to actual sender

### Issue 1 — ANZ improvements only apply to ANZ

Recent **code** fixes (boss-phone routing, multi-boss detection, RLS, BMS auto-sync, promise watchdog) are in edge functions and already apply to **every company** automatically. The real gap is **per-company configuration**: only ANZ has the upgraded baseline. The other 5 companies are still on the minimal seed (5 tools, 2 tool rounds, 2048 tokens, no BMS tools).

**Current state vs ANZ baseline:**

```text
company                       tools  rounds  model
ANZ General Dealers              7      6    glm-4.7   ← baseline
Omanut Technologies              9      2    glm-4.7
North Park School                5      2    glm-4.7
E Library                        5      2    glm-4.7
Finch Investments                5      4    glm-4.7
Art of Intelligence              5      2    gemini-3-pro
```

**Fix:** Bring all companies up to the ANZ baseline where appropriate, while preserving company-specific overrides (model, custom prompts, sales_mode):

1. **Bump `max_tool_rounds` to ≥ 4** for any company below 4 (sales-mode companies need this for `check_stock → record_sale → generate_payment_link` chains).
2. **Bump `max_tokens` to 4096** for any company below 4096 (matches ANZ baseline; previous 2048 cap was truncating long replies).
3. **Add the missing tools** to `enabled_tools` for every company so the universal capabilities work:
   - `check_stock`, `list_products` (BMS-aware companies)
   - `notify_boss`, `create_scheduled_post`, `send_media`, `lookup_product`
   - Skip BMS tools for companies without a BMS connection (E Library, Art of Intelligence, North Park School) — keep their non-BMS tool set.
4. **Update the `seed_company_ai_overrides()` trigger** so all *new* companies get the baseline (4 rounds, 4096 tokens, full universal tool set) instead of the minimal 2/2048/5 set.
5. **Run a one-shot migration** that re-seeds `company_agent_modes` for any company whose modes are stale, using `seed_company_agent_modes()` (already idempotent).

Customer-specific behaviour (custom prompts, business type, sales_mode in metadata, BMS connection flag, brand-only image mode) stays untouched.

### Issue 2 — ANZ not delivering generated images to the requester

**Root cause (confirmed from logs):** When the social-media-manager (`+260972064502`) requests an image via boss-chat, the generated image is delivered to `+260 967546533` (the legacy `companies.boss_phone` = owner) instead of back to the requester.

In `supabase/functions/boss-chat/index.ts`, every call to `whatsapp-image-gen` hardcodes:
```ts
bossPhone: company.boss_phone
```
at lines 1868, 1942, 2355. The actual sender's number (`From`) is in scope (it's already used at line 1442 for "Still working…" pings) but never forwarded.

The image-gen function (`whatsapp-image-gen/index.ts` line 1735) then dutifully sends to whatever `bossPhone` it receives — so the manager never sees their own image.

**Fix:**
- In `boss-chat/index.ts`, replace `bossPhone: company.boss_phone` with `bossPhone: From || company.boss_phone` at all 3 call sites (lines 1868, 1942, 2355). `From` is the WhatsApp number of whoever is actually chatting with the AI — owner, manager, or any registered boss-phone.
- This also fixes the same bug for image generation requested by future boss roles (accountant, operations, etc.) — they'll receive their own generations instead of the owner getting them all.

No changes needed in `whatsapp-image-gen` itself — it already handles arbitrary `bossPhone` correctly.

### Files

- **DB migration**: update `seed_company_ai_overrides()` trigger + one-shot UPDATE to backfill the 5 non-ANZ companies' `company_ai_overrides` (rounds, tokens, enabled_tools).
- **`supabase/functions/boss-chat/index.ts`**: 3 one-line changes (`From || company.boss_phone`).
- Redeploy `boss-chat`.

### Validation

1. From manager number `+260972064502`, ask the AI to "generate an image of X" → image arrives on `+260972064502`, not the owner.
2. From owner number `+260 967546533`, request an image → still arrives on owner (unchanged).
3. North Park / Finch / E Library customer asks a question that needs a tool chain → AI no longer truncates at round 2 or 2048 tokens.
4. New company created via admin → `company_ai_overrides` row has 4 rounds, 4096 tokens, full tool set out of the box.

No breaking schema changes. All existing custom prompts and per-company sales modes preserved.

