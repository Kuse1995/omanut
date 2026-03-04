

## Plan: WhatsApp-Based Post Scheduling for Boss/Manager

### Overview
Enable the boss to schedule Facebook posts directly from WhatsApp via natural language. The AI parses intent, content, time, and optionally generates a brand image, then sends a preview for approval before calling the existing `schedule-meta-post` function.

### How It Works (User Flow)

1. Boss sends: *"Schedule a post for tomorrow at 2pm: Check out our weekend special!"*
2. AI parses content + time, creates a draft in `scheduled_posts`
3. AI replies with preview: content, scheduled time, and asks "Reply APPROVE to schedule or EDIT to change"
4. If boss says *"Add an image"* → AI generates brand image, sends preview with image
5. Boss replies *"APPROVE"* → system calls `schedule-meta-post` edge function
6. Boss gets confirmation with Meta post ID

### Changes

#### 1. New Tool in `boss-chat/index.ts`
Add a `schedule_facebook_post` tool to the existing `managementTools` array:

```
{
  name: "schedule_facebook_post",
  description: "Schedule a Facebook post. The AI should parse the user's message to extract content and scheduled time.",
  parameters: {
    content: string,        // Post text
    scheduled_time: string, // ISO 8601 timestamp
    image_url?: string,     // Optional image URL
    needs_image_generation?: boolean  // If boss wants AI to generate an image
  }
}
```

**Tool handler logic:**
- Look up the company's `meta_credentials` to get the `page_id`
- Insert a row into `scheduled_posts` with status `draft`
- If `needs_image_generation` is true, call `whatsapp-image-gen` to generate an image, attach the URL
- Call the `schedule-meta-post` edge function internally (service role) to push to Facebook
- Return success/failure message to the boss

#### 2. Update System Prompt in `boss-chat/index.ts`
Add scheduling capability description to the system prompt so the AI knows it can schedule posts:

```
7. **Content Scheduling**: You can schedule Facebook posts for the business page.
   When the boss asks to schedule/post/publish content, use the schedule_facebook_post tool.
   Parse the desired date/time from natural language (e.g., "tomorrow at 2pm", "next Monday morning").
   If the boss mentions wanting an image, set needs_image_generation to true.
   Remember: scheduled time must be at least 10 minutes from now and within 75 days.
```

#### 3. No Database Changes
The `scheduled_posts` table already has all needed columns (`content`, `scheduled_time`, `image_url`, `page_id`, `company_id`, `status`, `created_by`).

#### 4. No New Edge Functions
Reuses existing `schedule-meta-post` and `whatsapp-image-gen` functions via internal service-role calls.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Add `schedule_facebook_post` tool + handler + system prompt update |

### Security
- Boss identity already verified by phone number match against `companies.boss_phone`
- Internal calls to `schedule-meta-post` use service role key
- `created_by` field will store a system identifier since boss doesn't have a dashboard user ID

