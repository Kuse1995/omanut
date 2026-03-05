

## Plan: Full Instagram Omnichannel Support

This is a large, multi-file change across 5 edge functions and 3 UI components. Here's the breakdown:

---

### 1. Database: Add `target_platform` column to `scheduled_posts`

Add a migration to support targeting Facebook, Instagram, or both:

```sql
ALTER TABLE public.scheduled_posts 
ADD COLUMN target_platform text NOT NULL DEFAULT 'facebook';
-- Values: 'facebook', 'instagram', 'both'
```

Also add an `ig_user_id` column to `meta_credentials` to store the Instagram Business Account ID (needed for IG API calls):

```sql
ALTER TABLE public.meta_credentials 
ADD COLUMN ig_user_id text;
```

---

### 2. Meta Webhook (`supabase/functions/meta-webhook/index.ts`)

Currently only handles `body.object === 'page'`. Instagram webhooks arrive with `body.object === 'instagram'`.

**Changes:**
- Accept both `'page'` and `'instagram'` in the object check (line 70)
- Add Instagram comment handler: `entry.changes` with `field === 'comments'` → extract comment text, commenter ID, media ID → call `handleInstagramComment()` which generates AI reply and posts via `POST /{comment-id}/replies`
- Add Instagram DM handler: `entry.messaging` under instagram object → extract sender ID, message text → call `handleInstagramDM()` which generates AI reply and sends via `POST /me/messages` with the IG-scoped sender ID
- Save interactions with `phone: 'ig:{userId}'` (comments) or `phone: 'igdm:{userId}'` (DMs) and `platform: 'instagram'` / `'instagram_dm'`
- Update `buildCompanySystemPrompt` to accept `'instagram_comment'` and `'instagram_dm'` context types
- Look up credentials by matching the `ig_user_id` field for Instagram webhooks

---

### 3. Schedule Meta Post (`supabase/functions/schedule-meta-post/index.ts`)

**Changes:**
- Read `post.target_platform` from the scheduled post record
- For `'facebook'` (existing logic): publish via FB Graph API as today
- For `'instagram'`: implement the two-step IG Content Publishing API:
  1. `POST /{ig_user_id}/media` with `{ image_url, caption }` → get `creation_id`
  2. `POST /{ig_user_id}/media_publish` with `{ creation_id }` → get published media ID
  - Note: IG requires an image — text-only posts are not supported
- For `'both'`: execute both Facebook and Instagram publishing sequentially
- Look up `ig_user_id` from `meta_credentials` alongside `access_token`

---

### 4. Boss Chat Tool (`supabase/functions/boss-chat/index.ts`)

**Changes to `schedule_facebook_post` tool (lines 753-767):**
- Rename tool to `schedule_social_post` (or keep name but update description)
- Add `target_platform` parameter: `{ type: "string", enum: ["facebook", "instagram", "both"], description: "Where to publish: facebook, instagram, or both" }`
- Update tool execution (lines 963-1062) to pass `target_platform` to the `scheduled_posts` insert
- Update the success message to reflect which platform(s) were targeted

---

### 5. Conversations Dashboard UI

**`src/components/conversations/ConversationItem.tsx`:**
- Add Instagram icon checks: `phone?.startsWith('ig:')` → pink/gradient Instagram badge, `phone?.startsWith('igdm:')` → pink Instagram DM badge
- Use the Lucide `Instagram` icon (it exists in lucide-react)

**`src/components/conversations/ConversationsList.tsx`:**
- Add `'instagram'` and `'instagram_dm'` filter options
- Add Instagram filter buttons with pink styling and counts

---

### 6. Content Scheduler UI (`src/components/admin/ContentSchedulerPanel.tsx`)

**Changes:**
- Add a `targetPlatform` state: `'facebook' | 'instagram' | 'both'`
- Add a platform selector (toggle group or select) in the compose form
- Pass `target_platform` in the `scheduled_posts` insert
- Show platform badge on each scheduled post in the list
- When `'instagram'` is selected, require an image (since IG doesn't support text-only posts)

---

### 7. Chat View Updates

**`src/components/conversations/ChatView.tsx`:**
- Add Instagram platform detection for `ig:` and `igdm:` prefixes
- Show appropriate badges ("Instagram Comment", "Instagram DM")
- Instagram comments should be read-only (same as Facebook comments — AI handles replies autonomously)

---

### Files Changed

| File | Change |
|------|--------|
| **Migration** | Add `target_platform` to `scheduled_posts`, `ig_user_id` to `meta_credentials` |
| `supabase/functions/meta-webhook/index.ts` | Handle `instagram` object, route IG comments & DMs to AI, save with `ig:`/`igdm:` prefixes |
| `supabase/functions/schedule-meta-post/index.ts` | Add Instagram 2-step publishing + `both` mode |
| `supabase/functions/boss-chat/index.ts` | Add `target_platform` param to scheduling tool |
| `src/components/conversations/ConversationItem.tsx` | Instagram icon badges |
| `src/components/conversations/ConversationsList.tsx` | Instagram filter buttons |
| `src/components/conversations/ChatView.tsx` | Instagram platform detection & badges |
| `src/components/admin/ContentSchedulerPanel.tsx` | Platform selector toggle |

