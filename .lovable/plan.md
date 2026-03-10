

# Fix: Duplicate Post Prevention

## Problem

When creating a social media post, duplicate posts can be inserted because there's no deduplication check. This can happen when:
- The AI calls `schedule_social_post` and the boss retries or resends
- Network timeouts cause the boss to repeat the request
- The AI mistakenly calls the tool twice in a single turn

## Solution

Add a deduplication guard in the `schedule_social_post` handler in `boss-chat/index.ts`. Before inserting a new post, check if a post with the same `company_id` + `content` + `target_platform` was created within the last 2 minutes. If so, return the existing post instead of creating a duplicate.

## Changes

### `supabase/functions/boss-chat/index.ts` — 1 insertion point (~line 1310, after image gen but before any insert)

Add a dedup check:
```typescript
// Deduplication: check for identical post in last 2 minutes
const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
const { data: existingPost } = await supabase
  .from('scheduled_posts')
  .select('id, status, image_url')
  .eq('company_id', company.id)
  .eq('content', args.content)
  .eq('target_platform', targetPlatform)
  .gte('created_at', twoMinAgo)
  .limit(1)
  .maybeSingle();

if (existingPost) {
  result = {
    success: true,
    message: `✅ This post was already created moments ago. No duplicate needed.`,
    imageUrl: existingPost.image_url || undefined,
  };
  break;
}
```

This single check covers all three insert paths (publish_now success, publish_now pending_image, and schedule-for-later). Place it right after `targetPlatform` is set (line ~1323) and before the `if (args.publish_now)` block.

No database changes needed.

