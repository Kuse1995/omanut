

# Update OpenClaw Skill Config for stdio Transport (mcp-remote bridge)

## Problem
OpenClaw (v2026.3.22) only supports **stdio** MCP transport — not `streamable-http`. The current `openclaw-skill.json` advertises `"transport": "streamable-http"` with a direct URL, which causes OpenClaw to skip the server entirely:
```
[bundle-mcp] skipped server "omanut-ai" because only stdio MCP servers are supported right now.
```

## Fix
Update `openclaw-skill.json` to use the `mcp-remote` npm bridge pattern, which wraps the HTTP endpoint as a local stdio process.

### Changes to `openclaw-skill.json`

Replace the current `skill` block:
```json
{
  "skill": {
    "name": "omanut-ai",
    "description": "Autonomous Company-in-a-Box — ...",
    "transport": "streamable-http",
    "url": "https://dzheddvoiauevcayifev.supabase.co/functions/v1/mcp-server",
    "headers": { "x-api-key": "YOUR_API_KEY_HERE" }
  }
}
```

With the stdio/mcp-remote config:
```json
{
  "skill": {
    "name": "omanut-ai",
    "description": "Autonomous Company-in-a-Box — ...",
    "transport": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "mcp-remote",
      "https://dzheddvoiauevcayifev.supabase.co/functions/v1/mcp-server",
      "--header",
      "x-api-key:YOUR_API_KEY_HERE"
    ]
  }
}
```

Update the `setup_instructions` to reflect the new setup:
1. Generate an API key in the Omanut dashboard (Settings → API Keys)
2. Replace `YOUR_API_KEY_HERE` in the args array with your key
3. Save this file to `~/.openclaw/skills/omanut-ai.json`
4. Make sure Node.js (v18+) is installed (needed for `npx`)
5. Restart OpenClaw — first launch takes a few seconds as `mcp-remote` downloads
6. Test with: "List my recent conversations"

### Why mcp-remote?
`mcp-remote` is an npm package that runs as a local stdio process and relays JSON-RPC messages to the remote HTTP MCP server. This bridges the gap between OpenClaw's stdio-only requirement and our HTTP-based edge function.

## Files Modified
- `openclaw-skill.json` — update transport from `streamable-http` to `stdio` with `mcp-remote` bridge args, update setup instructions

