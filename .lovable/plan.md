
Root cause is now clear from the live logs: the deployed `mcp-server` is crashing at startup because `schemaAdapter` calls `z.toJSONSchema(...)`, but the function is importing `zod@^3.25.0`, and that helper is not available there. So the earlier tool-registration refactor likely deployed, but the schema conversion approach is incompatible with the actual runtime version.

Plan:
1. Fix the MCP server bootstrap
   - Update `supabase/functions/mcp-server/index.ts` to stop using `z.toJSONSchema(...)` in `schemaAdapter`.
   - Replace it with a schema conversion approach that works in the edge runtime:
     - either upgrade to a Zod/runtime combination that definitely supports `toJSONSchema`
     - or preferably remove the dependency on that helper and use the `mcp-lite`-supported schema format directly in a stable way.

2. Keep the current tool definitions compatible
   - Review how all `server.tool(...)` registrations are currently structured.
   - Preserve the corrected `server.tool("name", { ... })` shape.
   - Make sure the chosen schema approach works for every existing tool without rewriting business logic.

3. Align dependency config
   - Update `supabase/functions/mcp-server/deno.json` so the declared imports match the implementation.
   - Avoid version drift between the code pattern and the available Zod API.

4. Verify HTTP transport assumptions
   - Keep the existing `StreamableHttpTransport` route and API-key auth flow intact.
   - Ensure the function can complete server creation before handling requests, since the current failure happens before any MCP request is processed.

5. Re-test the expected failure mode
   - After the fix, validate that:
     - invalid API keys return 401/403
     - valid requests no longer return 500
     - OpenClaw no longer sees `MCP error -32000: Connection closed`

Files to update:
- `supabase/functions/mcp-server/index.ts`
- `supabase/functions/mcp-server/deno.json`

Technical note:
```text
Current failing path:
request -> authenticateApiKey -> createMcpServer()
                              -> schemaAdapter(...)
                              -> z.toJSONSchema is undefined
                              -> startup crash -> HTTP 500 -> mcp-remote disconnects
```

Expected result after fix:
```text
request -> authenticateApiKey -> createMcpServer()
                              -> tools register successfully
                              -> StreamableHttpTransport handles MCP request
                              -> OpenClaw connects normally
```
