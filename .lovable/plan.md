

# Fix: Prevent Duplicate Publishing with Atomic Status Transitions

## Root Cause

The current `publish-meta-post` does a SELECT to check status, then later does an UPDATE. Between those two operations, another caller (cron-publisher, whatsapp-image-gen callback, or a retry) can also read the same "approved" status and publish again. This is a classic race condition.

## Solution: Atomic Claim Pattern

Use a single UPDATE ... WHERE to atomically claim a post for publishing. If the row was already claimed by another caller, the update returns 0 rows and we bail out.

## Changes

### 1. `supabase/functions/publish-meta-post/index.ts`

Replace the current SELECT-then-check pattern with an atomic claim:

```typescript
// Atomically claim this post for publishing
const { data: claimed, error: claimError } = await supabaseService
  .from('scheduled_posts')
  .update({ status: 'publishing', updated_at: new Date().toISOString() })
  .eq('id', post_id)
  .in('status', ['draft', 'scheduled', 'approved'])
  .select('*')
  .maybeSingle();

if (!claimed) {
  // Already claimed by another process or wrong status
  return Response({ error: 'Post already being published or not in publishable state' }, 409);
}
```

Then use `claimed` as the post object for the rest of the function. On success → update to `published`. On failure → update to `failed`.

Also keep the `pending_image` guard before the claim (unchanged).

### 2. `supabase/functions/cron-publisher/index.ts`

Add the same atomic pattern: instead of selecting `approved` posts then calling publish-meta-post for each, atomically update each post to `publishing` before calling. This prevents the next cron tick from picking up the same post.

```typescript
// For each due post, atomically claim it first
const { data: claimedPost } = await supabase
  .from('scheduled_posts')
  .update({ status: 'publishing' })
  .eq('id', post.id)
  .eq('status', 'approved')
  .select('id')
  .maybeSingle();

if (!claimedPost) continue; // Already claimed by another process
// Then call publish-meta-post
```

### 3. `supabase/functions/whatsapp-image-gen/index.ts`

In the auto-publish callback, set status to `publishing` (not `approved`) before calling publish-meta-post, so cron-publisher won't also grab it:

```typescript
// Update from pending_image → publishing (not approved)
await supabase.from('scheduled_posts')
  .update({ image_url: imageUrl, status: 'publishing' })
  .eq('id', scheduledPostId)
  .eq('status', 'pending_image');
```

### 4. `supabase/functions/publish-meta-post/index.ts` — Accept `publishing` status

Update the atomic claim to also accept `publishing` status (since whatsapp-image-gen and cron-publisher pre-set it):

```typescript
.in('status', ['draft', 'scheduled', 'approved', 'publishing'])
```

## Status Flow After Fix

```text
insert → approved/pending_image
           │              │
           │         (image ready)
           │              │
           ▼              ▼
       publishing ◄── publishing
           │
     ┌─────┴─────┐
     ▼           ▼
  published    failed
```

No database migration needed — `status` is a text column, not an enum.

