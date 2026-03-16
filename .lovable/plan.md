

# Enhance WhatsApp AI: Multi-Attachment Vision, Auto-Docs to Customers, Boss Approval Loop

## Current State

**What works:**
- Images (only `image/*`) are analyzed via `analyze-customer-image` — primarily for payment proof detection
- Quotations/invoices are created via BMS tools and returned as text summaries
- `generate-document` creates PDFs and sends them to the **boss only**
- `send_media` tool can send media library files to customers
- Audio, video, PDFs, and documents sent by customers are stored but **never analyzed**

**Gaps identified:**
1. **Non-image attachments are ignored** — voice notes, PDFs, documents, videos are stored but the AI has zero context about their content
2. **Quotations/invoices are text-only to customers** — BMS creates the record but no PDF is sent to the customer
3. **Boss has no visibility** when the AI sends a quotation/invoice to a customer
4. **No audio transcription** — voice notes are common on WhatsApp but completely ignored

---

## Proposed Enhancements

### 1. Multi-Attachment Vision (analyze all attachment types)

**Current:** Line 869-870 in `whatsapp-messages` — `if (mediaType.startsWith('image/'))` skips everything else.

**Enhancement:** Expand the analysis loop to handle:

| Type | How | Tool |
|------|-----|------|
| `image/*` | Gemini Vision (existing) | `analyze-customer-image` |
| `audio/*`, `audio/ogg` (voice notes) | Gemini audio understanding or transcription | New: expand `analyze-customer-image` to accept audio |
| `application/pdf` | Gemini document understanding (pass PDF as inline_data) | New: add PDF branch in analysis |
| `video/*` | Extract keyframes or pass to Gemini video | Future phase |

Gemini 2.5 Pro/Flash natively support audio and PDF inputs as `inline_data` parts. We can extend the existing `analyze-customer-image` function (or create `analyze-customer-attachment`) to:
- Accept any media type
- For audio: transcribe and summarize ("Customer sent a voice note saying: ...")
- For PDFs/documents: extract key content ("Customer sent a document containing: ...")
- Feed the extracted context into `imageAnalysisContext` for the AI to act on

### 2. Auto-Send Quotation/Invoice PDFs to Customers

**Current:** When `create_quotation` or `create_invoice` BMS tools execute, the result is a text summary. No PDF goes to the customer.

**Enhancement:** After BMS returns success for `create_quotation`/`create_invoice`:
1. Call `generate-document` with the BMS response data to create a branded PDF
2. Send the PDF to the **customer** via Twilio WhatsApp (MediaUrl)
3. The tool result includes the `pdf_url` so the AI can reference it in the reply

This happens automatically inside the tool handler in `whatsapp-messages`.

### 3. Boss Notification Loop for Quotations & Invoices

**Enhancement:** After generating and sending a quotation/invoice PDF to a customer:
1. Send a WhatsApp notification to the boss with the PDF attached
2. Include context: customer name, items, total amount
3. Log to `boss_conversations` for dashboard visibility

Format:
```
📄 QUOTATION SENT
Customer: John Doe
Items: Widget x5, Gadget x2
Total: K2,500
[PDF attached]
```

This reuses the existing `generate-document` WhatsApp delivery (already sends to boss) but adds the customer-facing send as a new step.

### 4. Additional Suggestions

- **Smart document routing**: If a customer sends a PDF that looks like a purchase order, auto-extract line items and offer to create a quotation
- **Voice note quick replies**: If the AI detects a voice note, transcribe it and treat the transcription as the message text (so all tools work with voice)
- **Embed conversation media**: Use Gemini embeddings on attachment descriptions to improve semantic search across conversation history

---

## Implementation (3 files)

### File 1: `supabase/functions/analyze-customer-image/index.ts` → rename to multi-attachment analyzer
- Accept `mediaType` parameter alongside `imageUrl`
- For `audio/*`: send as `inline_data` with `mime_type` to Gemini, ask for transcription + summary
- For `application/pdf`: send as `inline_data`, ask for content extraction
- For `image/*`: existing behavior (unchanged)
- Return new fields: `transcription` (for audio), `documentContent` (for PDFs)

### File 2: `supabase/functions/whatsapp-messages/index.ts`
- **Line 869-870**: Remove `image/` filter — analyze all media types, passing `mediaType` to the analyzer
- **Audio context injection**: If transcription returned, prepend to `imageAnalysisContext` as "Voice note transcription: ..."
- **PDF context injection**: If document content returned, add to context as "Customer shared a document: ..."
- **Post-BMS quotation/invoice handler** (after line 3676): When `create_quotation` or `create_invoice` succeeds, auto-call `generate-document` to create PDF, send to customer via Twilio, and notify boss

### File 3: No new files needed — `generate-document` already handles PDF creation and boss WhatsApp delivery

### Config: No database changes needed

---

## Impact

- Customers sending voice notes, PDFs, or documents get intelligent responses instead of silence
- Quotations and invoices are delivered as professional branded PDFs directly to the customer
- Boss gets real-time visibility on every quotation/invoice sent out
- No changes to existing image analysis or payment proof flows

