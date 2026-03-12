

# Fix: Boss-Chat Triggering Runaway Image Generations

## Root Cause Analysis

The logs tell the full story. The boss said **"Post them all the images we just created now"** — meaning use the **existing** images. But the AI called `schedule_social_post` **3 times** (one per product), each with `needs_image_generation: true` instead of referencing the already-generated images.

Here's what happened in sequence:

```text
Boss: "Post them all the images we just created now"

AI Round 1: schedule_social_post (LifeStraw Family 2.0, needs_image_generation=true, publish_now=true)
  → 50s sync image gen → TIMEOUT
  → Fire-and-forget ASYNC retry (second image gen call)

AI Round 2: schedule_social_post (LifeStraw Personal, needs_image_generation=true, publish_now=true)
  → 50s sync image gen → TIMEOUT
  → Fire-and-forget ASYNC retry

AI Round 3: schedule_social_post (LifeStraw Community, needs_image_generation=true, publish_now=true)
  → Sync image gen succeeds this time
  → Auto-publish callback fires

Result: 6 image generation calls for 3 posts. All published to Facebook.
```

**Three bugs compound here:**

1. **Prompt gap**: The system prompt doesn't tell the AI to look up recently generated images before setting `needs_image_generation=true`. The boss said "images we just created" but the AI has no tool to fetch recent generated images for reuse in posts.

2. **Double-fire on timeout**: When the 50s sync attempt times out, the code fires an async retry — but the original sync call may still be running (edge function didn't cancel it). Both can succeed, generating duplicate images.

3. **No concurrency gate**: The tool loop processes all 3 `schedule_social_post` calls sequentially in the same request, each spawning its own image gen. No limit on concurrent image generations per boss-chat session.

## Fix Plan

### 1. Add `get_recent_images` tool to boss-chat (new tool)
**File**: `supabase/functions/boss-chat/index.ts`

Add a tool that fetches recently generated images so the AI can reuse them instead of regenerating:
- Query `generated_images` for the company, last 30 minutes
- Return image URLs and prompts
- Add to system prompt: "When the boss says 'post the images we created', FIRST call `get_recent_images` to find existing URLs, then pass them as `image_url` to `schedule_social_post`. Do NOT set `needs_image_generation=true` for already-generated images."

### 2. Prevent double-fire on timeout
**File**: `supabase/functions/boss-chat/index.ts` (lines 1243-1276)

When the sync image gen times out, the code currently fires an async retry. But the original request may still be running server-side. Fix:
- Use an `AbortController` to cancel the sync fetch when the timeout fires, ensuring it doesn't complete in the background
- Only fire the async retry after confirming the sync was aborted

### 3. Add per-session image gen counter
**File**: `supabase/functions/boss-chat/index.ts`

Add a counter that tracks how many image generations have been triggered in this boss-chat session. Cap at 2 per session. If the AI tries to trigger more, return a message telling the boss the remaining posts will be queued and processed sequentially.

### 4. Strengthen the system prompt
**File**: `supabase/functions/boss-chat/index.ts` (system prompt section)

Add explicit instruction:
- "When the boss references images that were already generated ('post the images', 'use the images we made'), call `get_recent_images` first. Only set `needs_image_generation=true` if no matching images exist."
- "When posting multiple items, reuse `toolImageUrl` from prior `generate_image` calls. Do not regenerate."

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Add `get_recent_images` tool + handler, AbortController for sync timeout, per-session image gen cap (max 2), system prompt update |

No database changes. No new edge functions.

