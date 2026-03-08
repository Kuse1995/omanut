

# Fix Broken Pipe + Verify Instagram Token

## Context
The E Library Instagram token now includes `instagram_content_publish`. The remaining code issue is the **broken pipe** error: when `boss-chat` generates an image (20-30s via Gemini), the Supabase client connection goes stale, causing the subsequent `scheduled_posts` insert to fail.

## Change

### File: `supabase/functions/boss-chat/index.ts`

Create a **fresh Supabase client** right before the database insert at ~line 1169, after image generation completes. This ensures a live connection regardless of how long the image took.

```typescript
// Before the insert (~line 1166), create fresh client:
const freshSupabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
```

Then use `freshSupabase` instead of `supabase` for:
- The `scheduled_posts` insert (line 1169)
- The `scheduled_posts` update to `approved` (line 1220)

The rest of the function continues using the original `supabase` client (which is fine for reads earlier in the flow).

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Fresh Supabase client before post insert/update after image generation |

