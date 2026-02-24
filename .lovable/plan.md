

# Analysis: Demo Page Location & Intelligent Handoff System

## Demo Page Location

The demo page is at `/demo` (public showcase page at `src/pages/Demo.tsx`). There's also `/live-demo` (authenticated internal testing page at `src/pages/LiveDemo.tsx`).

## Current Handoff Problem

The current handoff logic is a single line in the system prompt:

```
If the customer explicitly asks to speak to a human, a manager, or has a complex issue
you absolutely cannot resolve, include [HANDOFF_REQUIRED] at the very end of your response.
Only use this when truly necessary.
```

This is too passive. The AI only hands off when the customer **explicitly asks** for a human. It has zero awareness of conversational milestones like "order complete, need to pass details to the restaurant." A customer who places an order, gives delivery info, and expects fulfillment will never trigger this because they never said "let me speak to a human."

## Proposed Solution: Intelligent Handoff Agent

Replace the single-line handoff instruction with a dedicated **Handoff Evaluation Agent** — a second AI call that runs after the main response, analyzing the conversation for handoff triggers based on context, not just explicit requests.

### How It Works

```text
Customer message arrives
        │
        ▼
  Main AI generates response
        │
        ▼
  Handoff Agent evaluates full conversation
  (lightweight, fast model - gemini-2.5-flash-lite)
        │
        ├── NO HANDOFF → send response as-is
        │
        ├── SOFT HANDOFF → AI completes interaction,
        │   sends structured summary to boss
        │   (e.g., order details, delivery info)
        │
        └── HARD HANDOFF → AI tells customer
            someone will follow up, sends urgent
            alert to boss
```

### Changes

#### 1. `supabase/functions/demo-session/index.ts`

**a) Remove `[HANDOFF_REQUIRED]` from system prompt** — the main AI no longer decides handoffs.

**b) Add `evaluateHandoff()` function** — after the main AI responds, call a second lightweight AI with the full conversation history and a structured evaluation prompt:

```text
Analyze this conversation and determine if a handoff to a human is needed.

HANDOFF TRIGGERS (return "soft_handoff"):
- Customer has completed an order/booking with all details provided
- Customer has shared payment/delivery information
- Customer has a complaint that needs real resolution
- Customer is negotiating a deal that needs human approval
- Customer shared sensitive personal/financial information

HARD HANDOFF TRIGGERS (return "hard_handoff"):
- Customer explicitly asks for a human/manager
- Customer expresses frustration after multiple exchanges
- Legal, safety, or emergency situation
- AI cannot resolve after 3+ attempts on same issue

NO HANDOFF (return "none"):
- General inquiries, FAQs, browsing
- Customer is still gathering information
- Conversation is naturally flowing

Return JSON: {
  "decision": "none" | "soft_handoff" | "hard_handoff",
  "reason": "brief explanation",
  "summary": "structured summary of key info for boss (only if handoff)",
  "extracted_data": { order details, contact info, etc. }
}
```

**c) Implement soft vs hard handoff behavior:**

- **Soft handoff**: AI responds normally to the customer (no interruption), but sends a structured summary to the boss with all extracted data (order items, delivery address, contact info, etc.)
- **Hard handoff**: AI tells the customer someone will follow up, sends urgent notification to boss

**d) Update boss notification format** to include structured extracted data:

```text
🔔 *[ORDER RECEIVED]*

👤 Customer: Sarah (+260971234567)
🏢 Demo: Pizza Palace

📋 *Order Summary:*
- 2x Margherita Pizza (Large)
- 1x Garlic Bread
- 1x Coca Cola

📍 *Delivery:*
Address: 123 Cairo Road, Lusaka
Time: ASAP

💰 Estimated total: ~K180

🤖 AI handled the full conversation. Customer expects confirmation.
```

### 2. No changes needed to `whatsapp-messages/index.ts`

The handoff logic is entirely within `demo-session`.

---

## Technical Details

| Aspect | Detail |
|--------|--------|
| Handoff model | `google/gemini-2.5-flash-lite` (fast, cheap, classification task) |
| Latency impact | ~200-400ms extra per message (runs in parallel or after response) |
| Evaluation frequency | Every customer message (lightweight enough) |
| Soft handoff | No customer interruption, boss gets structured data |
| Hard handoff | Customer notified, boss gets urgent alert |
| Backward compatible | Yes, same Twilio/WhatsApp flow |

