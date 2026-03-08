

# BMS Agent — Centralized Business Management System Gateway

## What We're Building

A dedicated `bms-agent` edge function that becomes the single entry point for all BMS operations. Three edge functions currently duplicate the same fetch logic to `bms-api-bridge` — we consolidate it into one agent and add new capabilities.

## Current Duplication

| File | BMS actions | Lines of duplicated fetch logic |
|------|------------|------|
| `whatsapp-messages/index.ts` | `check_stock`, `record_sale`, `generate_payment_link`, `lookup_product` | ~120 lines (lines 2988-3100) |
| `boss-chat/index.ts` | `check_stock`, `record_sale` | ~70 lines (lines 1239-1305) |
| `whatsapp-image-gen/index.ts` | `check_stock` (product context lookup) | ~25 lines (lines 729-751) |

All three hardcode the same external URL (`hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge`) and auth pattern.

## Changes

### 1. New: `supabase/functions/bms-agent/index.ts`

Centralized BMS gateway supporting these actions:

| Action | Description | Callers |
|--------|-------------|---------|
| `check_stock` | Look up inventory + pricing | All three |
| `record_sale` | Log a sale transaction | Customer, Boss |
| `generate_payment_link` | Create Lenco payment URL | Customer, Boss |
| `list_products` | Full product catalog | Customer, Boss |
| `get_product_details` | Product info + `image_urls` field (ready for BMS images) | Image Gen, Customer |
| `update_stock` | Adjust stock quantities | Boss only |
| `sales_report` | Daily/weekly sales summary | Boss only |

Internal design:
- Single `callBMS(action, params)` helper wrapping the external bridge URL + `BMS_API_SECRET`
- Validates required params per action
- Returns consistent `{ success, data, error }` envelope
- `verify_jwt = false` (called internally by other edge functions via service role)

### 2. Update: `supabase/functions/whatsapp-messages/index.ts`

Replace inline BMS fetch blocks (~lines 2988-3100) for `check_stock`, `record_sale`, `generate_payment_link`, `lookup_product` with internal calls:

```typescript
const bmsResult = await fetch(
  `${Deno.env.get('SUPABASE_URL')}/functions/v1/bms-agent`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'check_stock', params: { product_name: args.product_name } })
  }
);
```

Each tool handler shrinks from ~30 lines to ~10.

### 3. Update: `supabase/functions/boss-chat/index.ts`

- Replace inline `check_stock` and `record_sale` handlers (~lines 1239-1305) with calls to `bms-agent`
- Add two new tool definitions: `update_stock` and `sales_report`
- Update system prompt to mention new inventory management capabilities

### 4. Update: `supabase/functions/whatsapp-image-gen/index.ts`

Replace the inline BMS context fetch (~lines 729-751) with a call to `bms-agent` using `get_product_details`. This action will return `image_urls` when available from the BMS, enabling product-anchored image generation.

### 5. Config: `supabase/config.toml`

Add:
```toml
[functions.bms-agent]
  verify_jwt = false
```

## Architecture After

```text
Customer (WhatsApp) ──→ whatsapp-messages ──┐
Boss (WhatsApp)     ──→ boss-chat         ──┤──→ bms-agent ──→ External BMS Bridge
Image Generation    ──→ whatsapp-image-gen ──┤
External Agents     ──→ agent-api         ──┘
```

## `get_product_details` + Image URLs

The `get_product_details` action calls the BMS bridge and returns:
```json
{
  "name": "LifeStraw Family 2.0",
  "price": 450,
  "stock": 23,
  "description": "...",
  "image_urls": ["https://..."]  // from BMS when available
}
```

The image gen pipeline will use `image_urls` as reference anchors for multimodal generation (converting them to `inlineData` format for Gemini). This is ready to work as soon as the BMS project exposes `image_url`/`image_urls` fields per the prompt provided earlier.

## Files Summary

| Action | File |
|--------|------|
| Create | `supabase/functions/bms-agent/index.ts` |
| Edit | `supabase/functions/whatsapp-messages/index.ts` |
| Edit | `supabase/functions/boss-chat/index.ts` |
| Edit | `supabase/functions/whatsapp-image-gen/index.ts` |
| Edit | `supabase/config.toml` |

