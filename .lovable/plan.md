

## Fix: secondary boss number still routes to customer AI

### Root cause (confirmed from edge function logs)

Runtime error in `whatsapp-messages`:
```
[BOSS-DETECT] Error loading boss phones: ReferenceError: getBossPhones is not defined
```

The previous fix added two `getBossPhones(...)` call sites in `supabase/functions/whatsapp-messages/index.ts` (lines 4997 and 6115) but **never added the import**. The `try/catch` swallows the ReferenceError, `allBossPhonesNormalized` falls back to just the legacy `companies.boss_phone` (260967546533 — the owner), and ANZ's secondary social_media_manager number (+260972064502) is never recognized as a boss → message goes to the customer AI.

DB confirms both rows exist for ANZ:
- `+260 967546533` — owner (legacy)
- `+260972064502` — social_media_manager ✓

### Fix

#### 1. Add the missing import in `supabase/functions/whatsapp-messages/index.ts`
Add at the top alongside the other `_shared` imports:
```ts
import { getBossPhones } from "../_shared/boss-phones.ts";
```

#### 2. Fix the legacy 3-arg call site (line ~4997)
Current: `getBossPhones(supabase, company.id, company.boss_phone)` — third arg is a string, but the signature expects a `BossPhoneFilter` object. Change to:
```ts
const bossPhones = await getBossPhones(supabase, company.id);
```
(Function already falls back to `companies.boss_phone` internally when the table is empty.)

#### 3. Stop swallowing the boss-detect error
In the `try/catch` around `getBossPhones` (line ~6114), log loudly and re-throw in dev — at minimum, change the catch to also log the stack so future regressions surface immediately:
```ts
} catch (e) {
  console.error('[BOSS-DETECT] Error loading boss phones:', e instanceof Error ? e.stack : e);
}
```

#### 4. Deploy + verify
- Deploy `whatsapp-messages`.
- Re-text from `+260972064502` to ANZ's WhatsApp.
- Check logs for `Phone comparison:` — `allBossPhonesNormalized` should now contain both `260967546533` and `260972064502`, and `isBoss: true`.
- The reply should come from boss-chat (with the social-media-manager role context), not the customer assistant.

### Files

- `supabase/functions/whatsapp-messages/index.ts` — add import, fix legacy call site, harden catch.

No DB changes, no UI changes, no other functions touched.

