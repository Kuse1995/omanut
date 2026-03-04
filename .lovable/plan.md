

## Meta Webhook Verification — Already Exists

The `meta-webhook` Edge Function already exists at `supabase/functions/meta-webhook/index.ts` and already handles exactly what you described:

- **GET** verification: checks `hub.mode === 'subscribe'`, compares `hub.verify_token` against `META_VERIFY_TOKEN` secret, returns `hub.challenge` as plain text with 200, or 403 on mismatch.
- **POST** handling: processes Facebook page messaging and feed events.
- **JWT disabled**: already set in `supabase/config.toml`.

### What needs to change

Only one minor update: you want the verify token hardcoded to `omanut_secure_123` instead of reading from `META_VERIFY_TOKEN` env var.

**Option A (Recommended):** Just set the `META_VERIFY_TOKEN` secret to `omanut_secure_123` — no code change needed. The existing code already reads it.

**Option B:** Hardcode it in the function by changing one line:
```typescript
// FROM:
const verifyToken = Deno.env.get('META_VERIFY_TOKEN');
// TO:
const verifyToken = 'omanut_secure_123';
```

### Files to modify
- `supabase/functions/meta-webhook/index.ts` — only if Option B is chosen (1 line change)

### Webhook URL for Meta
```
https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-webhook
```

