
The user is saying that when a customer (or boss) asks the AI for stock levels of multiple items, the AI tries to format the response as a table, which doesn't render well in WhatsApp. WhatsApp doesn't support markdown tables — they appear as raw pipes and dashes, broken across lines on mobile.

This is a formatting rule, not a logic bug. The fix is in the system prompt — explicitly forbid markdown tables and prescribe a clean WhatsApp-native format (bullet list with bold names).

Where to add the rule:
- The whatsapp-messages edge function builds the system prompt. There's likely a "formatting rules" section or output style block. I should add a hard rule there.
- This applies to ALL companies, not just Finch — every WhatsApp tenant has the same rendering constraint.

Proposed fix is small: one prompt rule + one example. No DB, no UI, no schema.

What the rule should say:
> NEVER use markdown tables (no `|`, no `---` separators). WhatsApp renders them as broken text. For multi-item data (stock, prices, lists), use this format instead:
> 
> *Item Name* — value
> *Item Name* — value
> 
> Example for stock:
> *LSC* — 90 in stock @ K8,600
> *LSF 2.0* — 45 in stock @ K12,000
> *LSMax* — 12 in stock @ K18,500

Plan is tiny. No need to ask questions.
