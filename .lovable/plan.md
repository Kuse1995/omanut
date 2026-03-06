

## Fix: Instagram Messages Not Being Processed

### Root Cause Analysis

From the edge function logs, **zero Instagram webhook events** have been received by `meta-webhook`. The logs only show Facebook Page events (`object: "page"`). This points to two issues:

1. **Instagram webhook subscription may not be configured** in your Meta App settings (the `instagram_manage_messages` permission and Instagram webhook fields need to be enabled separately from the Page subscription).

2. **Instagram DMs can arrive through the Page subscription** (with `object: "page"` and `entry[].messaging`) when using the Messenger Platform for Instagram. Your current code would silently handle these as Facebook Messenger DMs, but only if they arrive at all.

3. **No timeout configured** for `meta-webhook` in `config.toml`. The 15-second delay for Instagram comment replies could cause the function to be killed before posting.

### Changes

#### 1. `supabase/functions/meta-webhook/index.ts`

**Better entry-point logging** (~line 38):
- Log the full `object` type and entry IDs so we can see if Instagram events arrive but get silently dropped.

**Instagram DM detection within `page` handler** (~lines 110-127):
- When processing `entry.messaging` under `object: "page"`, detect if the sender is an Instagram-scoped user by checking if the credential record has an `ig_user_id` and comparing sender ID patterns.
- If the DM appears to be from Instagram, route to `handleInstagramDM` instead of `handleMessengerDM`.
- This handles the case where Instagram DMs arrive through the unified Page webhook.

**Add fallback credential lookup for Instagram**:
- In `getIgCredentials`, if no match on `ig_user_id`, try looking up by `page_id` as a fallback (since the linked Page ID is known).

**Add error logging for credential lookup failures**:
- Log explicitly when credential lookups return null with the lookup key, so silent failures become visible.

#### 2. `supabase/config.toml`

- Add `timeout = 60` for `meta-webhook` to accommodate the 15-second delay + AI generation time for Instagram comment replies.

### Post-Implementation: Manual Step Required

You will need to verify in your **Meta App Dashboard** (developers.facebook.com) that:
- The Instagram product is added to your app
- Webhook fields `messages` and `comments` are subscribed under the Instagram product
- The `instagram_manage_messages` and `instagram_manage_comments` permissions are approved
- Your Instagram Business Account is connected to the app

Without these subscriptions, no Instagram events will reach your webhook regardless of code changes.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Add diagnostic logging, Instagram DM detection in page handler, fallback credential lookup |
| `supabase/config.toml` | Add `timeout = 60` for meta-webhook |

