

# Fix "Invalid API Key" in MCP Server

## Diagnosis

The function is deployed and running (no more 500). The "Invalid API key" error means the SHA-256 hash of the received key doesn't match any row in `company_api_keys`. Two active keys exist in the DB.

The hashing logic in both `manage-api-keys` (key creation) and `mcp-server` (key validation) is identical, so the algorithm isn't the issue.

**Most likely cause**: The `mcp-remote` bridge may be passing the header value with extra whitespace or formatting differences. The header format `--header "x-api-key:YOUR_API_KEY_HERE"` (no space after colon) is correct for mcp-remote, but the actual key value the user pasted may have trailing whitespace, newline characters, or quotes that get hashed differently.

## Fix

Add diagnostic logging to `authenticateApiKey` in `mcp-server/index.ts` so we can see exactly what's being received and matched:

1. **Log the received key prefix and computed hash** — this lets us compare against the stored `key_prefix` and `key_hash` values in the DB
2. **Trim the API key** before hashing — this handles any whitespace the bridge may add
3. **Log the DB query result** (found/not-found, error) for clear debugging

### Changes to `supabase/functions/mcp-server/index.ts`

In the `authenticateApiKey` function (~line 21-55):

```typescript
async function authenticateApiKey(req: Request, supabase: any): Promise<{ companyId: string } | Response> {
  const rawApiKey = req.headers.get("x-api-key");
  if (!rawApiKey) {
    return new Response(JSON.stringify({ error: "Missing x-api-key header" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  
  // Trim whitespace that mcp-remote bridge might add
  const apiKey = rawApiKey.trim();
  const keyPrefix = apiKey.substring(0, 12);
  const keyHash = await hashKey(apiKey);
  
  console.log(`[MCP-AUTH] Key prefix: ${keyPrefix}, hash: ${keyHash.substring(0, 16)}...`);
  
  const { data: keyRecord, error } = await supabase
    .from("company_api_keys")
    .select("id, company_id, is_active, expires_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error) {
    console.error("[MCP-AUTH] DB error:", error.message);
  }
  
  if (!keyRecord) {
    console.warn(`[MCP-AUTH] No key found for prefix ${keyPrefix}`);
    return new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // ... rest stays the same
```

This will:
- **Trim the key** to fix whitespace issues from mcp-remote
- **Log the prefix** so we can verify which key is being sent
- **Log hash prefix** so we can compare to DB values
- **Separate DB errors** from "not found" for clearer diagnosis

### Files Modified
- `supabase/functions/mcp-server/index.ts` — trim API key input + add auth logging

