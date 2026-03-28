

# Fix MCP Server 500 Error — Wrong `mcp-lite` API Usage

## Root Cause

The edge function logs show this error on every request:
```
TypeError: Cannot read properties of undefined (reading 'inputSchema')
    at McpServer.tool (mcp-lite/dist/index.js:726:61)
```

The `mcp-lite` library expects this call signature:
```ts
mcp.tool('toolName', { description, inputSchema: z.object({...}), handler })
```

Our code uses:
```ts
server.tool({ name: "toolName", description, inputSchema: { type: "object", ... }, handler })
```

Three issues:
1. **Name must be the first argument** (string), not inside the config object
2. **inputSchema must be a Zod schema**, not a plain JSON Schema object
3. **McpServer needs a `schemaAdapter`** to convert Zod → JSON Schema

## Fix

### 1. Update `deno.json` — add Zod dependency

```json
{
  "imports": {
    "hono": "npm:hono@^4.7.10",
    "mcp-lite": "npm:mcp-lite@^0.10.0",
    "zod": "npm:zod@^4.1.12"
  }
}
```

### 2. Rewrite `mcp-server/index.ts` — all ~40 tool registrations

Every `server.tool({...})` call must be converted from:
```ts
server.tool({
  name: "list_conversations",
  description: "...",
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  handler: async (params) => { ... }
});
```

To:
```ts
server.tool("list_conversations", {
  description: "...",
  inputSchema: z.object({ limit: z.number().optional() }),
  handler: async (params) => { ... }
});
```

Also update the McpServer constructor:
```ts
import { z } from "zod";
const server = new McpServer({
  name: "omanut-ai",
  version: "1.0.0",
  schemaAdapter: (schema) => z.toJSONSchema(schema as z.ZodType),
});
```

This is a large mechanical refactor (~40 tools, ~1000 lines) but each change follows the same pattern. No logic changes — only the tool registration API format.

## Files Modified
- `supabase/functions/mcp-server/deno.json` — add `zod` import
- `supabase/functions/mcp-server/index.ts` — fix all tool registrations to use correct mcp-lite API

