

## Plan: Return Generated Image URL When Scheduling Posts

### Problem
When the `schedule_facebook_post` tool generates an image, the image URL is correctly attached to the Facebook post and scheduled, but it is never sent back to the boss on WhatsApp. The `boss-chat` function's final response (line 1091) only returns `{ response: aiResponse }` without an `imageUrl` field. The `whatsapp-messages` function checks for `bossData.imageUrl` to attach media, but it's always `false` for scheduled posts.

### Fix

**File: `supabase/functions/boss-chat/index.ts`**

1. Track the image URL generated during tool execution by declaring a variable (e.g., `let toolImageUrl = null`) before the tool loop.

2. In the `schedule_facebook_post` case (around line 1003), capture the generated image URL into this variable:
   ```typescript
   toolImageUrl = imageUrl;
   ```

3. Update the final response (line 1091) to include the image URL:
   ```typescript
   return new Response(JSON.stringify({ 
     response: aiResponse,
     imageUrl: toolImageUrl || undefined
   }), { ... });
   ```

This ensures that when the whatsapp-messages function checks `bossData.imageUrl`, it finds the generated image and attaches it as media to the WhatsApp reply.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Track and return `imageUrl` from tool execution in the final response |

