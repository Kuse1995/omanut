

User generated an admin key, downloaded the skill JSON, but OpenClaw can't find a "skill" called `omanut-ai-admin` — it's looking in its skills directory. The issue: the file we generate is shaped as a "skill" wrapper, but OpenClaw/ClawHub treats skills as published packages. What OpenClaw actually needs for a remote MCP server is an **MCP server config** (added to its MCP servers list), not a skill.

Let me check the current generated file shape and the openclaw-skill.json template to confirm.

Looking at ApiKeysSection.tsx buildSkillJson — it produces:
```
{ skill: { name, description, transport: 'stdio', command: 'npx', args: [...] } }
```

That's a custom shape. OpenClaw (Claude Code/Claw) actually uses MCP server configs in its settings — typically the standard `mcpServers` schema:
```
{
  "mcpServers": {
    "omanut-ai-admin": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<url>", "--header", "x-api-key:<key>"]
    }
  }
}
```

OpenClaw's response confirms: it's searching ClawHub for a published skill named `omanut-ai-admin`. We don't want a published skill — we want a registered MCP server.

Plan: change the download to produce a standard MCP server config + give the user copy-paste-friendly install instructions. Also rename to remove "skill" terminology that's confusing OpenClaw.

Keep tight.

