

# Randomize Comment Reply Delays to Reduce Bot Detection

## Problem
Facebook suppresses notifications for replies it detects as automated. The current fixed 15-second delay is a bot fingerprint — real humans reply with variable timing.

## Fix

### `supabase/functions/meta-webhook/index.ts`

Replace the fixed 15-second delay in both `handleFacebookComment` and `handleInstagramComment` with a randomized delay between **45–120 seconds**.

```typescript
// Replace:  await new Promise(resolve => setTimeout(resolve, 15000));
// With:
const delayMs = Math.floor(Math.random() * 75000) + 45000; // 45-120 seconds
console.log(`Waiting ${Math.round(delayMs/1000)}s before posting reply...`);
await new Promise(resolve => setTimeout(resolve, delayMs));
```

Two locations to update:
- **Line ~545** (Facebook comments)
- **Line ~688** (Instagram comments)

**Important caveat:** Meta intentionally throttles notifications for API-sourced replies — this is a platform-level anti-spam measure. Randomized delays will help but won't guarantee notifications for every reply. The replies themselves will still post successfully and be visible on the post.

| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Replace fixed 15s delay with random 45-120s delay in both FB and IG comment handlers |

