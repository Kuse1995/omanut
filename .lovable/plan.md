## Goal

Two related upgrades, framed around the real-world scenario: a customer sends a product photo on WhatsApp asking "do you have this in stock?".

1. **See customer images in the chat UI** (admin Conversations panel) — they're already stored in Supabase Storage but never render because of a metadata-shape mismatch.
2. **Let the AI forward those images to the boss** via a new `forward_media_to_boss` tool, so the owner gets the actual product photo on WhatsApp instead of a text-only summary.

---

## What's broken today

| Layer | Current state |
|---|---|
| Inbound (WhatsApp) | `whatsapp-messages` downloads each `MediaUrl{i}` into the `conversation-media` bucket and saves it on the user message as `message_metadata.media_urls: string[]` + `media_types: string[]`. ✅ |
| Chat UI (`ChatBubble.tsx`) | Reads `metadata.media_url` / `metadata.media_type` (singular). Inbound customer images are stored as **arrays**, so the bubble renders **nothing** — the photo is invisible to the operator. ❌ |
| Boss notifications | `sendBossHandoffNotification` only sends a text WhatsApp ping. There is no path for the AI to attach the customer's image. ❌ |
| `notify_boss` tool | Accepts only text fields (`summary`, `details`). No media param. ❌ |
| `send-boss-notification` edge fn | Already supports an optional `mediaUrl` body field and forwards it to Twilio as `MediaUrl`. ✅ (we'll reuse this.) |

---

## Plan

### 1. Render inbound customer media in the chat (frontend only)

**File:** `src/components/conversations/ChatBubble.tsx`

- Normalize incoming metadata at the top of the component:
  - If `metadata.media_urls` (array) exists, treat it as the source of truth.
  - Otherwise fall back to the existing singular `metadata.media_url`.
- Render **all** media items in the bubble (multi-image WhatsApp messages currently lose every image after the first), each clickable to open the existing `MediaViewer`.
- Keep current single-item behavior intact for assistant messages and historical data.

**File:** `src/components/conversations/MediaGallery.tsx`

- Same normalization in the `useMemo` that flattens messages → media items, so the gallery counts and lists every image in array-form messages, not just the first.

No backend changes. No DB changes. Existing rows immediately display correctly because the data is already there.

### 2. New tool: `forward_media_to_boss`

**File:** `supabase/functions/whatsapp-messages/index.ts`

Add a tool definition next to `notify_boss`:

```text
forward_media_to_boss(
  reason: string,             // e.g. "Customer asking if we stock this product"
  caption?: string,           // short note to the boss, max 1 sentence
  media_index?: number = 0    // which of the customer's just-sent images to forward
)
```

Behavior in the tool handler:
1. Resolve the URL from the current turn's `storedMediaUrls[media_index]` (preferred) or, if absent, the most recent `messages` row from this customer with non-empty `message_metadata.media_urls`.
2. Build a boss WhatsApp message that mirrors `sendBossHandoffNotification`'s style and adds the customer photo:
   - `📸 Customer sent a product photo`
   - Customer name + phone
   - The AI's `reason` and `caption`
   - The same paid-lead `📢 PAID LEAD` enrichment block (ad headline + today's spend) we already build in `sendBossHandoffNotification`, when `conversations.ad_context` is present.
3. Call the existing `send-boss-notification` edge function with `notificationType: 'action_required'`, `data.message`, and the resolved `mediaUrl` so Twilio attaches it as MMS to every opted-in `company_boss_phones` row.
4. Log the action via `boss_conversations` (already done by `send-boss-notification`).

Prompt updates in the same file:
- Add a hard rule under the existing handoff section: *"When the customer sends a product image and asks about stock, availability, price or fitment for that exact item, you MUST call `forward_media_to_boss` (not just `notify_boss`) so the boss can identify the product visually."*
- Add the tool to the `alwaysEnabledTools` allow-list so it cannot be silently disabled per-company.

### 3. Mirror the same flow on Messenger / Instagram

**File:** `supabase/functions/meta-webhook/index.ts`

Confirmed images from Meta DMs are already persisted into `message_metadata.media_urls`. The fix in step 1 + the new tool in step 2 automatically work for Messenger/IG too because the AI runs through the same processor. No additional change required beyond a code review pass.

### 4. Memory

Append a short rule file `mem://features/customer-media-forwarding.md` documenting:
- Inbound customer media is stored as arrays on `messages.message_metadata`.
- The AI has a dedicated `forward_media_to_boss` tool — `notify_boss` is text only.
- Operators can see all customer-sent media in the chat thread and in the Media Gallery dialog.

---

## Out of scope (intentional)

- **Operator → customer** image sending from the chat UI (already exists via `send_media` tool / agent workspace).
- Re-encoding or thumbnailing — the `conversation-media` bucket is already public and Twilio accepts the URL directly.
- Changes to `boss-chat` flow: this is one-way customer→boss forwarding, the boss can already reply normally.

---

## Touch list

- `src/components/conversations/ChatBubble.tsx` — array-aware rendering
- `src/components/conversations/MediaGallery.tsx` — array-aware extraction
- `supabase/functions/whatsapp-messages/index.ts` — new tool, prompt rule, handler
- `mem://features/customer-media-forwarding.md` — new memory file
