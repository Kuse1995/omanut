

## Plan: Use Company AI Config & Knowledge Base for Meta Replies

### Problem
Currently each Meta credential has its own `ai_system_prompt` field that must be manually typed. This duplicates the existing company-level AI configuration (system instructions, QA style, banned topics) and knowledge base (quick reference info, documents) that are already maintained elsewhere.

### Solution
Update the `meta-webhook` edge function to load the company's full AI context automatically. The per-credential `ai_system_prompt` becomes an optional **override/addition** rather than the primary source.

### Changes

**`supabase/functions/meta-webhook/index.ts`**

In `handleComment` and `handleMessengerDM`, after resolving `company_id`:

1. Fetch `company_ai_overrides` for the company — extract `system_instructions`, `qa_style`, `banned_topics`
2. Fetch `companies` row — extract `quick_reference_info`, `name`, `business_type`, `services`
3. Fetch `company_documents` — extract `parsed_content` from all documents
4. Build a composite system prompt combining all sources:
   - Company identity (name, business type, services)
   - `system_instructions` from AI overrides
   - `qa_style` directives
   - `banned_topics` restrictions
   - `quick_reference_info` knowledge base
   - Document library content (summarized)
   - The credential's `ai_system_prompt` as an additional layer (if present)
5. Pass this composite prompt to `generateAIReply` instead of just `ai_system_prompt`

Refactor into a helper: `buildCompanySystemPrompt(supabase, companyId, credentialPrompt, context)`.

**`src/components/admin/MetaIntegrationsPanel.tsx`**

- Rename the "AI System Prompt" label to "Additional Instructions (Optional)"
- Add helper text: "Leave empty to use your company's AI settings and knowledge base automatically. Add text here only for page-specific overrides."

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Add company context loading, build composite prompt |
| `src/components/admin/MetaIntegrationsPanel.tsx` | Update label and helper text |

