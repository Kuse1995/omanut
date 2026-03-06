

## Fix: Multi-Image WhatsApp Messages for Pending Posts

### Problem
When `get_pending_posts` returns multiple posts with images, `boss-chat` only returns a single `imageUrl` field. The `whatsapp-messages` handler attaches that one image to the first text chunk only. All other posts' images are lost.

### Solution
Return a structured array of per-post messages from `boss-chat`, and update `whatsapp-messages` to loop through them, sending one WhatsApp API call per post (each with its own image attachment), followed by a concluding text-only prompt.

### Changes

#### 1. `supabase/functions/boss-chat/index.ts`

**`get_pending_posts` tool handler (~line 1165-1183)**:
- In addition to the text summary in `result.message`, attach an array called `pendingMediaMessages` to the response.
- Each entry: `{ body: "Post 1: <caption preview>\n📅 <time> | 📱 <platform>", imageUrl: "<image_url or null>" }`
- Add a final entry with no image: `{ body: "Which of these would you like to edit or approve?", imageUrl: null }`

**Response return (~line 1276)**:
- Pass through the new `mediaMessages` array in the JSON response alongside the existing `response` and `imageUrl` fields.
- Store the `pendingMediaMessages` in a variable (similar to `toolImageUrl`) and include it in the response JSON.

#### 2. `supabase/functions/whatsapp-messages/index.ts`

**Boss response handler (~line 3994-4034)**:
- Before the existing `splitMessage` flow, check if `bossData.mediaMessages` exists and is a non-empty array.
- If yes: loop through the array, sending one Twilio API call per item (with `MediaUrl` if `imageUrl` is present, `Body` from the item's text). Add 500ms delays between sends. Skip the normal chunk-splitting flow entirely.
- If no: fall through to the existing single-image chunk logic (no change to current behavior).

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | `get_pending_posts` builds `mediaMessages` array; response includes it |
| `supabase/functions/whatsapp-messages/index.ts` | Detect `mediaMessages` array and send individual WhatsApp messages per post |

