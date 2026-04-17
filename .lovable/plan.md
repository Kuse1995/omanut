

OpenClaw expects a "skill package" — a folder with `SKILL.md`, optional `references/` and `scripts/` — zipped up. Not just a JSON config. The MCP server config we generate is correct for *Claude Desktop / Cursor / mcp-remote* style clients, but OpenClaw treats it as a **skill** that wraps an MCP server.

User already proved this: they zipped a folder with SKILL.md + references + scripts, OpenClaw installed it.

So I need to make the download produce a **ZIP** containing:
- `SKILL.md` (workflow guide for training the AI across companies)
- `mcp.json` (the MCP server config we already generate)
- `references/` (workflow docs: session flow, tool catalog, autonomous loop, guardrails)
- `scripts/` (optional helper — skip for now, keep it lean)

Filename: `omanut-ai-admin.zip` / `omanut-ai-<company>.zip`.

Need a zip lib in the browser. JSZip is the standard — already common in Lovable projects. Check if installed.

Plan stays tight. No need for clarifying questions.

