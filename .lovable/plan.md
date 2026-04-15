

## Fix: AI Hallucinating Media URLs Instead of Using Library

### Root Cause
The AI skips `search_media` and jumps straight to `send_media` with **fabricated URLs** (e.g. `cdn.filestackcontent.com`). The domain validation correctly rejects them, but instead of recovering, it gives up with "Sorry, I can only share from our official library."

### Fix (2 changes, 1 file)

**File: `supabase/functions/whatsapp-messages/index.ts`**

#### 1. Auto-recovery: when `send_media` gets invalid URLs, internally run `search_media`
Instead of rejecting and giving up at line ~2892, add a fallback that:
- Extracts the caption/category from the `send_media` args as a search query
- Runs the same search_media logic (vector → text → recent) internally
- If results found, replaces the invalid URLs with real storage URLs and continues to Twilio dispatch
- Only shows the "sorry" message if the internal search also finds nothing

#### 2. Strengthen the tool description to prefer `search_media` first
Update the `send_media` tool description (line 2130) to:
```
"Send media files to customer via WhatsApp. IMPORTANT: You MUST call search_media first to get valid URLs. Never fabricate or guess URLs."
```

And add to the system prompt instructions (around line 1892):
```
"CRITICAL: NEVER invent or guess media URLs. ALWAYS call search_media first, then use the exact URLs it returns in send_media."
```

### Expected behavior after fix
- Customer asks "share the bread bin picture"
- AI calls `send_media` with hallucinated URL → auto-fallback searches for "bread bin" in library → finds matching media → sends actual image via Twilio
- No more "sorry, official library only" when the image actually exists in the library

### Technical detail
The auto-recovery search uses `args.caption || args.category` as the query, reusing the existing 3-tier search (vector → ilike text → recent). Found URLs go through the existing signed-URL generation + Twilio dispatch path.

