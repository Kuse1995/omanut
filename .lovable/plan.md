

## Plan: Fix Timezone Handling for Scheduled Posts

### Problem
The `boss-chat` system prompt injects the current time as UTC via `new Date().toISOString()` (line 590) and the `scheduled_time` tool parameter description says "ISO 8601 timestamp" with a `Z` (UTC) example. The AI has no awareness that the boss is in the Africa/Lusaka (GMT+2) timezone, so "07:00" from the boss becomes `07:00:00Z` = 09:00 local time.

### Fix

**File: `supabase/functions/boss-chat/index.ts`**

1. **Line 590** -- Replace the UTC timestamp with a timezone-aware local time string and explicitly state the boss's timezone:
   ```typescript
   // Replace:
   Current date/time: ${new Date().toISOString()}
   
   // With:
   Current UTC time: ${new Date().toISOString()}
   The boss is in the Africa/Lusaka timezone (GMT+2). When the boss says a time like "07:00", they mean 07:00 local time (which is 05:00 UTC). ALWAYS convert local times to UTC by subtracting 2 hours before setting scheduled_time. For example: "tomorrow at 7am" → scheduled_time should be "...T05:00:00Z".
   ```

2. **Line 758** -- Update the `scheduled_time` parameter description to reinforce UTC conversion:
   ```typescript
   // Replace:
   description: "ISO 8601 timestamp for when to publish (e.g., 2026-03-05T14:00:00Z)"
   
   // With:
   description: "ISO 8601 timestamp in UTC. Convert boss's local time (GMT+2) to UTC by subtracting 2 hours. E.g., boss says 7am → use 05:00:00Z"
   ```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Add timezone context to system prompt and tool parameter description |

