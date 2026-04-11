

## Problem: AI Regenerates Images on Every Message

The root cause is that **conversation history stored in `boss_conversations` only saves plain text** (message + response). When the boss sends a follow-up like "post it today", the AI loads 12 recent history messages but sees NO record of which images were generated, which tool calls were made, or which image URLs are active. So it treats every message as a fresh context and regenerates.

The `toolImageUrl` variable, `imageGenCount`, and `(globalThis).__imageGenInProgress` are all per-request — they reset on every new message.

---

## Solution: Persist Image Context in Conversation History

### Step 1: Add `tool_context` column to `boss_conversations`

Store a JSON blob alongside each conversation entry that captures the image/tool state at the end of each request.

```sql
ALTER TABLE boss_conversations 
  ADD COLUMN tool_context jsonb DEFAULT NULL;
```

The `tool_context` will store:
```json
{
  "last_image_url": "https://...",
  "last_image_id": "uuid",
  "last_video_url": "https://...",
  "image_gen_count": 1,
  "pending_post_id": "uuid"
}
```

### Step 2: Inject image context into the AI's conversation history

When building `historyMessages` from the last 12 entries, scan for the most recent `tool_context` that contains a `last_image_url`. Inject a synthetic system message at the conversation boundary:

```
"[CONTEXT] The last generated image URL is: https://... — REUSE this URL for any scheduling, posting, or publishing. Do NOT call generate_image again unless the boss explicitly asks for a NEW image."
```

This gives the AI deterministic, in-context knowledge of the active image.

### Step 3: Save tool context at end of each request

After the tool loop completes, save `toolImageUrl`, `imageGenCount`, and any `pendingPostId` into the `tool_context` column of the new `boss_conversations` entry.

### Step 4: Pre-populate `toolImageUrl` from history on request start

Before entering the tool loop, check the most recent `boss_conversations` entry for a `tool_context.last_image_url`. If found (and it's < 60 minutes old), pre-set `toolImageUrl` so the `schedule_social_post` handler immediately has the image without needing the AI to call `get_recent_images`.

### Step 5: Add a hard gate in `generate_image` tool handler

Before executing `generate_image`, check if `toolImageUrl` is already set (from either the current session or history context). If yes AND the boss's message matches a publish-intent pattern (post it, schedule it, approve, etc.), skip the generation and return the existing URL instead.

---

## Files to Change

| File | Change |
|------|--------|
| Migration SQL | Add `tool_context jsonb` column to `boss_conversations` |
| `boss-chat/index.ts` | 1. Load `tool_context` from recent history and pre-populate `toolImageUrl` (~5 lines after line 1307) |
| `boss-chat/index.ts` | 2. Inject image-context system message into `historyMessages` (~3 lines after line 1313) |
| `boss-chat/index.ts` | 3. Save `tool_context` when inserting to `boss_conversations` (~line 2709) |
| `boss-chat/index.ts` | 4. Add hard gate in `generate_image` handler to skip if `toolImageUrl` is already set and boss intent is non-generative (~line 2290) |

This is a focused fix — ~40 lines of new code in the edge function plus a 1-line migration.

