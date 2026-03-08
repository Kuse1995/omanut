

# Fix Instagram DM Webhook Delivery

## Problem
The logs show **zero** Instagram DM events reaching the webhook. Messenger DMs work fine (`object=page`, `entry.messaging`), but no Instagram messages appear at all. This means Meta isn't delivering IG DM events to our webhook.

## Root Cause
The `subscribe-meta-page` function only subscribes the **Facebook Page** to webhooks (`/{page_id}/subscribed_apps`). For Instagram DMs, you also need to subscribe the **Instagram account** itself. The current code just adds a comment saying "Instagram events routed via page subscription" — but that assumption is incorrect for DMs.

## Fix

### 1. `supabase/functions/subscribe-meta-page/index.ts`
Add an Instagram-level subscription when `ig_user_id` is present:

```typescript
// After page subscription, subscribe IG account
if (cred.ig_user_id) {
  const igSubUrl = `https://graph.facebook.com/v18.0/${cred.ig_user_id}/subscribed_apps`;
  const igRes = await fetch(igSubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscribed_fields: 'messages',
      access_token: cred.access_token,
    }),
  });
  igResult = await igRes.json();
}
```

### 2. Additional diagnostic logging in `meta-webhook/index.ts`
Add a top-level log that prints the full `object` type for every webhook delivery, so we can see if Instagram events start arriving after the subscription fix.

### Important Note
If the IG subscription API returns a permissions error, it likely means the Meta App needs `instagram_manage_messages` approved through Meta App Review. This is a manual step in the Meta Developer Dashboard that cannot be done via code. I'll add clear error reporting so we know exactly what's happening.

| File | Change |
|------|--------|
| `supabase/functions/subscribe-meta-page/index.ts` | Add IG account webhook subscription via `/{ig_user_id}/subscribed_apps` |
| `supabase/functions/meta-webhook/index.ts` | Add diagnostic logging for object type |

