

# Pause Instagram DM Auto-Replies

## Problem
Instagram DM responses require Meta App Review approval before the messaging API can be used. Everything else (Messenger DMs, Instagram comments, Facebook comments) should continue working.

## Fix

### `supabase/functions/meta-webhook/index.ts`

Add an early return at the top of the `handleInstagramDM` function (line ~732) that:
1. Logs the incoming message for visibility
2. Saves the incoming message to the database (so it appears in conversations) but does NOT generate or send an AI reply
3. Returns immediately — no API call to Instagram

```typescript
async function handleInstagramDM(supabase, igUserId, senderId, messageText) {
  console.log(`[IG DM] Received from ${senderId}: "${messageText.slice(0,80)}" — auto-reply PAUSED (pending Meta App Review)`);

  // Still save the incoming message for visibility
  const cred = await getIgCredentials(supabase, igUserId);
  if (cred?.company_id) {
    await saveInteraction(supabase, cred.company_id, `igdm:${senderId}`, 'instagram_dm',
      'Instagram User', messageText, null,
      { source: 'instagram_dm', sender_id: senderId },
      null,
    );
  }
  return; // Auto-reply paused
}
```

This keeps all Instagram DM **receiving** and **logging** intact, only suppresses the AI reply + send. Once Meta approves the app, we just remove the early return.

| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Replace `handleInstagramDM` body with receive-only logic (no AI reply, no send) |

