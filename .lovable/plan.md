

## Diagnosis

The AI isn't getting E Library's instructions because there are **two duplicate `meta_credentials` rows** for the same page ID `776455652221283`:

| Row | company_id | ai_system_prompt |
|-----|-----------|-----------------|
| Old | NULL | Generic prompt |
| New | `dddb3024-...` (E Library) | Empty (correct) |

The webhook query `.limit(1).maybeSingle()` picks up the old row with `company_id = NULL`, so it never loads the company's knowledge base, AI instructions, or documents.

## Fix

### 1. Database Cleanup
Delete the old orphaned credential row (the one with `company_id = NULL`):

```sql
DELETE FROM meta_credentials WHERE page_id = '776455652221283' AND company_id IS NULL;
```

### 2. Edge Function Hardening (`meta-webhook/index.ts`)
Update `getPageCredentials` to **prefer rows with a `company_id`** so this can't happen again:

```sql
-- Change the query to order by company_id so non-null comes first
.select('access_token, ai_system_prompt, company_id')
.eq('page_id', pageId)
.not('company_id', 'is', null)
.limit(1)
.maybeSingle()
```

Add a fallback: if no row with `company_id` is found, try without the filter (backward compatibility).

### Files Changed

| Action | File |
|--------|------|
| Migration | Delete orphaned `meta_credentials` row |
| Edit | `supabase/functions/meta-webhook/index.ts` — prefer company-scoped credentials |

