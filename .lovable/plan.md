

# Fix: Boss Phone Number Normalization in Image Delivery

## Problem
The `boss_phone` field in the `companies` table is inconsistent — some entries store `whatsapp:+260972064502` while others store `+260973630503`. The `whatsapp-image-gen` function blindly prepends `whatsapp:` to the boss phone, creating invalid numbers like `whatsapp:whatsapp:+260972064502` which Twilio silently rejects.

The `send-boss-notification` function already handles this correctly (line 107-108) by stripping existing prefixes, but `whatsapp-image-gen` does not.

## Fix

### 1. Add phone normalization in `whatsapp-image-gen/index.ts`

Add a helper function and apply it to all `bossPhone` usage (4 locations at lines 1610, 1647, 1673, 1699):

```typescript
function normalizeBossPhone(phone: string): string {
  const clean = phone.replace(/^whatsapp:/, '').replace(/^\+?/, '+');
  return `whatsapp:${clean}`;
}
```

Replace all instances of:
```typescript
formData.append('To', `whatsapp:${bossPhone}`);
```
with:
```typescript
formData.append('To', normalizeBossPhone(bossPhone));
```

### 2. Also fix in `poll-video-generation/index.ts`

The same pattern exists there (line 248) — apply the same normalization.

## Files to Edit

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-image-gen/index.ts` | Add `normalizeBossPhone` helper, apply at 4 locations |
| `supabase/functions/poll-video-generation/index.ts` | Apply same normalization to boss phone |

Both edge functions will be redeployed automatically.

