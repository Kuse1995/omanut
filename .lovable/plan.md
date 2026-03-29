

# Fix: `create_scheduled_post` MCP Tool -32603 Internal Error

## Root Cause

The `scheduled_posts` table schema and the MCP tool's insert are mismatched in three ways:

| MCP tool uses | Actual column | Issue |
|---|---|---|
| `caption` | `content` | Wrong column name — insert silently fails or is ignored |
| `platform` | `target_platform` | Wrong column name |
| *(missing)* | `page_id` (NOT NULL, no default) | Missing required field — causes the DB error |

The tool inserts `caption` and `platform` (which don't exist as columns), while the actual NOT NULL columns `content`, `page_id`, and `target_platform` are left empty. This causes a Postgres NOT NULL violation, which mcp-lite wraps as `-32603 Internal Error`.

It "worked once" likely because the caller happened to provide data that matched a different code path, or the error was masked.

## Fix

**File: `supabase/functions/mcp-server/index.ts`** (lines 454-470)

1. Map `caption` param → `content` column
2. Map `platform` param → `target_platform` column  
3. Look up the company's `page_id` from `meta_credentials` before inserting (same pattern used by `auto-content-creator`)
4. Add a `created_by` field with the system UUID default
5. Wrap the handler in try/catch to return a clear MCP error message instead of an unhandled throw

Updated handler:
```typescript
handler: async (params: any) => {
  // Fetch page_id from meta_credentials
  const { data: cred } = await supabase
    .from("meta_credentials")
    .select("page_id")
    .eq("company_id", companyId)
    .limit(1)
    .maybeSingle();
  
  if (!cred?.page_id) {
    return { content: [{ type: "text", text: JSON.stringify({ 
      error: "No Meta credentials configured. Add a Facebook Page in Meta Integrations first." 
    }) }] };
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      company_id: companyId,
      page_id: cred.page_id,
      content: params.caption,           // caption → content column
      image_url: params.image_url || null,
      video_url: params.video_url || null,
      target_platform: params.platform,   // platform → target_platform column
      scheduled_time: params.scheduled_time,
      status: "pending_approval",
      created_by: "00000000-0000-0000-0000-000000000000",
    })
    .select()
    .single();
  if (error) throw error;
  return { content: [{ type: "text", text: JSON.stringify({ action: "created", post: data }, null, 2) }] };
},
```

## Also Fix: `review_scheduled_post` (same column mismatch)

Line 430 updates `caption` but the column is `content`. Change:
```typescript
if (params.updated_caption) updates.content = params.updated_caption;
```

## Scope

- One file changed: `supabase/functions/mcp-server/index.ts`
- Redeploy the `mcp-server` edge function

