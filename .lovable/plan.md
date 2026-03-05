

## Add "Approve & Publish Now" to Boss Chat

### Problem
Currently, approving a pending post via WhatsApp only schedules it for its future `scheduled_time`. The user wants to approve and have it published immediately without a separate command.

### Solution
Add a `publish_now` option to the `review_pending_post` tool in `boss-chat`. When the boss says "approve and post now" or "publish post 1", the tool will:

1. Update the post status to `scheduled`
2. Call `publish-meta-post` (immediate publish) instead of `schedule-meta-post` (future schedule)

The existing "approve" action remains unchanged (schedules for the future time). A new action value `approve_and_publish` triggers immediate publishing.

### Changes

**`supabase/functions/boss-chat/index.ts`**

1. Update the `review_pending_post` tool definition to add `approve_and_publish` as an action option alongside `approve`, `edit`, `reject`
2. Update the system prompt to explain the difference: "approve" = schedule for later, "approve and publish" / "post now" = publish immediately
3. Add handler for `approve_and_publish` action that calls `publish-meta-post` instead of `schedule-meta-post`

Key code addition (~15 lines) in the `review_pending_post` case block:
```typescript
} else if (args.action === 'approve_and_publish') {
  await supabase.from('scheduled_posts').update({ status: 'scheduled' }).eq('id', targetPostId);
  const schedRes = await fetch(`${SUPABASE_URL}/functions/v1/publish-meta-post`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SRK}` },
    body: JSON.stringify({ post_id: targetPostId }),
  });
  // handle response...
}
```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Add `approve_and_publish` action to tool definition, system prompt, and handler |

