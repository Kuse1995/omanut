

## Two Issues to Fix

### Issue 1: AI Response Truncated (cuts off at "BED")

**Root cause**: Line 2282 in `whatsapp-messages/index.ts` hard-caps max_tokens:
```
maxTokens = messageComplexity === 'simple' ? Math.min(350, configured) : Math.min(1024, configured)
```
ANZ has `max_tokens: 2048` configured in the database, but it's capped at 1024 for complex and 350 for simple. A full BMS catalog listing exceeds 1024 tokens, so the response gets cut off mid-way through the product categories (ending abruptly at "BED").

**Fix**: Respect the company's configured `max_tokens` value. Remove the hard cap and use the database-configured value directly:
- Simple messages: `Math.min(512, configuredMaxTokens)` (raise from 350)
- Complex messages: use `configuredMaxTokens` directly (no artificial 1024 cap)

Also apply the same uncapped limit to the multi-round tool loop (line 4455) and fallback paths.

### Issue 2: Ticket Created Instead of AI Answer ("TKT-001")

**Root cause**: When the customer asked "Do you have any tissues in stock?", the AI couldn't find tissues in the BMS catalog and called the `create_support_ticket` tool to escalate — instead of simply telling the customer "we don't currently stock tissues."

**Fix**: Update the `create_support_ticket` tool description (line 2441) to make it clear this tool should ONLY be used when a customer explicitly asks for human help or reports a real issue — never for product availability questions. Add to the system prompt instructions that when a product is not found in BMS/catalog, the AI should inform the customer it's not currently available rather than creating a ticket.

### Changes

**File: `supabase/functions/whatsapp-messages/index.ts`**

1. **Line 2282** — Remove 1024 cap: change to `const maxTokens = messageComplexity === 'simple' ? Math.min(512, configuredMaxTokens) : configuredMaxTokens;`

2. **Line 4455** — Match: change `Math.min(1024, maxTokens)` to just `maxTokens`

3. **Line 2441-2442** — Update `create_support_ticket` tool description to:
   `"Creates a support ticket ONLY when a customer explicitly requests human assistance, reports a genuine problem/complaint, or needs help that the AI truly cannot provide. NEVER create tickets for: product availability questions (just say it's not in stock), pricing inquiries, general questions, or anything the AI can answer directly."`

4. **System prompt** (around line 1892) — Add instruction:
   `"If a product is not found in BMS inventory or media library, tell the customer it's not currently available and offer alternatives. Do NOT create a support ticket for product availability questions."`

### Expected results
- BMS catalog listings will no longer get cut off — the full product list including BED category will be shown
- "Do you have tissues?" will get a direct "we don't currently stock that" response instead of a ticket
