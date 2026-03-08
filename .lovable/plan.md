

# Fix Boss Chat Context: Add Multi-Round Tool Loop + Quotation Workflow

## Problem

When you say "create a quotation for Omanut Technologies, 4 lifestraw max", the AI wants to:
1. `check_stock` (to get the unit price)
2. `create_quotation` (with the price it found)
3. `generate_document` (to make the PDF)

But boss-chat only executes **one round** of tool calls. After `check_stock` returns, the result is dumped directly to you as the final answer. The AI never gets a chance to use that result to call `create_quotation`.

## Solution

### 1. Add multi-round tool execution loop to `boss-chat/index.ts`

After the first tool calls execute, feed the results back to the AI as tool-result messages and call the AI again. Repeat up to 5 rounds until the AI returns a text response without tool calls. This lets the AI chain: stock check → create quotation → generate PDF in a single user turn.

```
Round 1: AI calls check_stock → gets price K14000
Round 2: AI calls create_quotation with price → gets quotation data
Round 3: AI calls generate_document → gets PDF
Round 4: AI returns final text: "Here's your quotation PDF!"
```

### 2. Update system prompt for quotation workflow clarity

Add explicit instruction: "When creating a quotation and the user mentions a product from inventory, first check_stock to get the current price, then create_quotation with the correct unit_price, then generate_document to create and send the PDF. Complete all steps in one go."

### 3. Implementation detail

Replace the current single-pass tool handling block (lines ~1097-2124) with a loop:
- Build messages array with system + history + user message
- Loop (max 5 rounds):
  - Call AI with messages + tools
  - If no tool calls → break with final response
  - Execute all tool calls, collect results
  - Append assistant message (with tool_calls) + tool result messages to the messages array
  - Continue loop
- Use the final AI text as the response

This matches the architecture described in the memory note about multi-round tool execution.

