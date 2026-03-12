# Phase 1: BMS Deep Integration — COMPLETED ✅

## What Was Built

### bms-agent/index.ts — 9 new actions added
- `get_product_variants` — colors/sizes for products
- `create_order` — customer order placement
- `get_order_status` — order tracking
- `update_order_status` — boss updates order status
- `cancel_order` — cancel orders
- `get_customer_history` — purchase history lookup
- `get_company_statistics` — impact stats
- `create_quotation` — formal price quotes
- `create_invoice` — invoice generation
- Enhanced `sales_report` with `date_from`, `date_to`, `group_by`

### whatsapp-messages/index.ts — Customer-facing tools
- 9 new tool definitions for customer AI
- Complexity classifier updated with order/variant/quote/invoice triggers
- Mandatory checkout tools expanded
- Tool handlers for all new BMS actions

### boss-chat/index.ts — Boss-facing tools
- 8 new tool definitions (order mgmt, customer history, stats, quotes, invoices)
- Tool handlers with formatted emoji responses

### bms-callback/index.ts — NEW webhook endpoint
- Receives proactive BMS events (low_stock, new_order, payment_confirmed, order_shipped, daily_summary, etc.)
- Authenticated via BMS_API_SECRET
- Sends WhatsApp notifications to boss and/or customer via Twilio

# Phase 2: Operations, Finance & HR — COMPLETED ✅

## What Was Built

### bms-agent/index.ts — 10 new actions added
- `get_low_stock_items` — products below reorder level
- `record_expense` — log business expenses
- `get_expenses` — expense history with filters
- `get_outstanding_receivables` — unpaid invoices
- `get_outstanding_payables` — pending vendor bills
- `profit_loss_report` — P&L with date range
- `clock_in` — employee attendance start
- `clock_out` — employee attendance end
- `create_contact` — website contact form submissions
- Fixed `sales_report` params: `start_date`/`end_date` (was `date_from`/`date_to`)
- Added `tracking_number` to `update_order_status`

### boss-chat/index.ts — 9 new tool definitions + handlers
- `get_low_stock_items` — inventory warnings
- `record_expense` — expense tracking
- `get_expenses` — expense reporting
- `get_outstanding_receivables` — accounts receivable
- `get_outstanding_payables` — accounts payable
- `profit_loss_report` — financial performance
- `clock_in` / `clock_out` — HR attendance
- Updated `sales_report` tool to use `start_date`/`end_date`
- Updated system prompt with Finance & HR capabilities

### whatsapp-messages/index.ts — Customer-facing
- Added `create_contact` tool definition + handler
- Updated complexity classifier with `expense|payable|receivable|contact|inquiry`

### bms-callback/index.ts — New event
- Added `new_contact` event handler (notifies boss of website inquiries)

## Phase 2.5: PDF Document Generation — COMPLETED ✅

### generate-document/index.ts — NEW edge function
- Generates professionally branded A4 PDFs using pdf-lib
- Supports 8 document types: invoice, quotation, sales_report, expense_report, profit_loss, receivables, payables, stock_report
- Fully branded templates: company header bar, footer with contact info, "Powered by Omanut AI" watermark
- Auto-uploads to company-documents storage with 7-day signed URLs
- Auto-sends PDFs to boss via WhatsApp (Twilio)
- Invoices include payment info (MTN/Airtel mobile money numbers)

### boss-chat/index.ts — generate_document tool added
- Boss can say "send me the sales report as PDF" or "I need an invoice PDF"
- AI fetches data first (via BMS tools), then calls generate_document with the results
- System prompt updated with document generation instructions

## Phase 2.6: Streaming Acknowledgements — COMPLETED ✅

### Problem Solved
BMS tool calls taking >8s left users staring at silence. Now sends an immediate "working on it..." message via Twilio while continuing to wait for the BMS result.

### Architecture
Race-based timeout: `Promise.race([bmsFetch, 8s_timer])`. If timer wins, fire-and-forget a Twilio ack, then await the real result.

### whatsapp-messages/index.ts
- Added `sendStreamingAck()` helper — sends ack via Twilio
- Added `bmsCallWithAck()` wrapper — race-based timeout around any BMS fetch
- Consolidated 13 individual BMS tool handlers into a single unified handler with param mapping
- Applied to multi-round tool loop (rounds 2-5) as well
- Context-aware ack messages per tool type (🔍 inventory, 📊 reports, 🛒 orders, 📄 documents)

### boss-chat/index.ts
- Inline race-based timeout added to the consolidated BMS switch-case
- Sends ack to boss WhatsApp number when BMS calls exceed 8s
- Same context-aware messages

## Phase 2.7: Hard Geometry Product Fidelity — COMPLETED ✅

### Problem Solved
AI-generated product images sometimes exhibited "Brand Hallucination" (warped logos, invented elements) and "Product Mutation" (wrong packaging shape, altered labels). No formal enforcement existed.

### Architecture
"Hard Geometry" constraint system: BMS product references are treated as immutable ground truth, not creative suggestions.

### whatsapp-image-gen/index.ts — 4 agents updated
- **Agent 2 (Reference Curator)**: Tags product matches with `[HARD GEOMETRY]` — locks label layout, color hex codes, logo placement, packaging form factor
- **Agent 3 (Prompt Optimizer)**: New `HARD GEOMETRY CONSTRAINT` rule block — explicit anchor language for pixel-perfect label preservation
- **Agent 4 (Supervisor Review)**: Added Brand Hallucination Check and Product Mutation Check as explicit rejection criteria
- **Agent 5 (Quality Assessment)**: 
  - Renamed dimensions: Product Fidelity (3x), Brand Hallucination Check (3x), Product Mutation Check (2x)
  - Raised pass threshold from 8.0 → 8.5
  - Auto-fail for warped logos, invented brand elements, wrong packaging type, altered label layout
  - Weighted score now /13 (was /11)
- **Generation prompt prefix**: "HARD GEOMETRY LOCK" with 6 mandatory constraints

## Phase 2.8: Frustration Signal Detection & Auto-Escalation — COMPLETED ✅

### Problem Solved
When the AI Agent makes 2+ consecutive errors (wrong image, wrong stock data, tool failures, behavior drift), users get frustrated but the system had no detection or escalation mechanism.

### Architecture
Post-response frustration check runs after every AI reply. Queries `ai_error_logs` for consecutive errors. Also scans incoming messages for frustration keywords. Triggers silent boss notification with `#SYSTEM_RECALIBRATION_REQUIRED`.

### whatsapp-messages/index.ts
- **`detectFrustrationSignals()`** — queries recent errors from `ai_error_logs`, checks for 2+ consecutive errors or frustration keyword + 1 error
- **Frustration keywords**: "wrong", "not what I asked", "already told you", "incorrect", "you keep", "frustrated", "useless", etc.
- **Error types tracked**: `behavior_drift`, `wrong_stock_data`, `bms_error`, `wrong_image`, `tool_failure`, `hallucination`
- **De-duplication**: Won't re-escalate within 30 minutes of a previous escalation
- **Tool failure logging**: BMS tool catch blocks now insert `ai_error_logs` entries with `error_type: 'tool_failure'`
- **Integration point**: Runs after response validation, before inserting assistant message

### send-boss-notification/index.ts
- New `system_recalibration` notification type
- Message format: `🚨 #SYSTEM_RECALIBRATION_REQUIRED` with error count, types, and `TAKEOVER [phone]` command

## Phase 2.9: OpenAI gpt-image-1 Migration — COMPLETED ✅

### Problem Solved
Migrated image generation from Gemini `gemini-3-pro-image-preview` to OpenAI `gpt-image-1` for higher quality output.

### Architecture
- New `openaiImageGenerate()` — calls `/v1/images/generations` with `b64_json` output
- New `openaiImageEdit()` — calls `/v1/images/edits` with multipart form data for product-anchored/edit flows
- Both return `{ imageBase64, text }` for drop-in compatibility
- Text-based agents (Prompt Optimizer, Supervisor, Quality Assessment) remain on `geminiChat`

### Files Updated
- `_shared/gemini-client.ts` — added `openaiImageGenerate` + `openaiImageEdit`
- `whatsapp-image-gen/index.ts` — main generation + editImage function
- `generate-business-image/index.ts` — single call site
- `auto-content-creator/index.ts` — single call site
- `test-image-generation/index.ts` — pipeline generation call site
- Pipeline version bumped to `6-agent-v2-openai`

## Phase 2.10: Image-First Publishing Pipeline — COMPLETED ✅

### Problem Solved
When the boss asked to publish a post with an image "right now," the system raced image generation against a 45s timeout. If generation was slow, it silently published text-only and the image was never delivered.

### Architecture
"Generate First, Publish Second" — synchronous 90s image generation attempt. If that fails, post enters `pending_image` state and async generation auto-publishes + notifies boss when ready.

### Files Updated
- `boss-chat/index.ts` — Removed 45s race pattern. Sync 90s gen → publish with image. Fallback: `pending_image` status + async fire-and-forget with `scheduledPostId` callback
- `publish-meta-post/index.ts` — Added guard: refuses to publish `pending_image` posts (handled by callback)
- `whatsapp-image-gen/index.ts` — Added auto-publish callback: when `scheduledPostId` is provided, updates post `image_url`, changes status to `approved`, calls `publish-meta-post`, sends WhatsApp confirmation with image preview to boss. On failure, marks post as `failed` and notifies boss.

### Key Behaviors
- **Happy path**: Image generates within 90s → published with image immediately
- **Slow gen**: Post saved as `pending_image` → async gen completes → auto-publishes → boss gets WhatsApp confirmation with image
- **Failed gen**: Post marked `failed` → boss notified → can retry by asking again
- **No silent degradation**: A post with a requested image NEVER goes out as text-only without explicit boss consent

## Phase 2.11: BMS Effectiveness Fixes — COMPLETED ✅

### Problem Solved
Customer-facing BMS calls were missing `company_id` (breaking multi-tenant), `get_product_details` caused 100% failures (unsupported by bridge), customers couldn't browse the catalog (`list_products` missing from routing), and tool descriptions lacked field name hints.

### Files Updated
- `bms-agent/index.ts` — Removed `get_product_details` from `AVAILABLE_ACTIONS`
- `whatsapp-messages/index.ts`:
  - Injected `company_id: company.id` into all BMS params (multi-tenant fix)
  - Added `list_products` tool definition with `current_stock`/`unit_price` field hints
  - Added `list_products` to mandatory checkout tools and BMS routing
  - Updated `check_stock` description with field name hints
  - Removed `get_product_details` ack message

## Phase 2.12: Image Generation Reliability Fixes — COMPLETED ✅

### Problems Solved
1. Wrong products generated despite reference images (BMS product anchoring broken)
2. AI going quiet when image gen times out (cascade timeout → 520 → empty TwiML)
3. "You'll receive an image" but it never arrives (no delivery mechanism for standalone async images)

### Files Updated
- `whatsapp-image-gen/index.ts`:
  - Replaced `get_product_details` (unsupported) with `list_products` in product selection (2 call sites)
  - Quality assessment fallback changed from auto-pass (score 7) to auto-fail (score 5) — forces retry instead of silently passing bad images
  - Added standalone boss image delivery: when `bossPhone` is set and no `scheduledPostId`, sends completed image directly via Twilio WhatsApp
  - Added failure notification for standalone boss image gen failures
- `boss-chat/index.ts`:
  - Reduced image gen timeout from 45s → 30s
  - On timeout: fires async `whatsapp-image-gen` with `bossPhone` for delivery callback
  - Added `__imageGenInProgress` flag — prevents AI from stacking multiple image gen calls across rounds
  - Tool result on timeout explicitly tells AI "Do NOT request another image"

## Next Phases (Pending)
- Phase 3: Full Coverage (HR extensions, agents/distributors, assets, website/content)
