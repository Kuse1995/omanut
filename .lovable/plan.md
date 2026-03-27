

# Connect OpenClaw via MCP Server

## Overview
Create an MCP-compatible edge function that exposes your existing `agent-api` actions as MCP tools. OpenClaw connects to it as an MCP skill and gets full access to conversations, analytics, training, and more.

## Architecture

```text
OpenClaw Agent
    │
    │  MCP Protocol (SSE + JSON-RPC)
    ▼
mcp-server (edge function)
    │
    │  Internal calls
    ▼
agent-api (existing) + direct DB queries
```

## Changes

### 1. New edge function: `supabase/functions/mcp-server/index.ts`
An MCP-compliant server using SSE transport that:
- Authenticates via the same `x-api-key` system as `agent-api`
- Exposes tools matching agent-api actions: `list_conversations`, `get_conversation`, `get_analytics`, `list_customers`, `list_tickets`, `send_message`, etc.
- Adds new analysis-focused tools not in agent-api:
  - `analyze_conversation_quality` — scores a conversation's AI responses for tone, accuracy, helpfulness
  - `get_ai_config` — reads current AI overrides/settings for the company
  - `update_knowledge_base` — adds/updates knowledge base entries
  - `search_knowledge_base` — searches existing KB entries
  - `list_recent_errors` — pulls AI error logs for review

### 2. New agent-api actions (in existing `agent-api/index.ts`)
Add these actions to support OpenClaw analysis workflows:
- `get_ai_config` — returns `company_ai_overrides` settings
- `update_knowledge_base` — insert/update `company_knowledge_base` entries
- `search_knowledge_base` — search KB by keyword
- `list_ai_errors` — query `ai_error_logs` table
- `get_conversation_messages` — get full message history with metadata for analysis

### 3. OpenClaw configuration file
Generate an `openclaw-skill.json` config file the user can drop into their OpenClaw `~/.openclaw/skills/` directory, pre-configured with:
- MCP endpoint URL pointing to the edge function
- API key header configuration
- Tool descriptions for OpenClaw's agent to understand capabilities

## Use Cases Enabled

| Use Case | Tools Used |
|---|---|
| Conversation QA | `list_conversations` → `get_conversation` → analyze patterns |
| Auto-train KB | `get_conversation` → extract facts → `update_knowledge_base` |
| Error monitoring | `list_ai_errors` → categorize → `create_ticket` |
| Performance dashboards | `get_analytics` → trend analysis |
| Customer insights | `list_customers` → segment analysis |
| Config optimization | `get_ai_config` → suggest improvements |

## Files Modified
- `supabase/functions/mcp-server/index.ts` — new MCP-compatible edge function
- `supabase/functions/agent-api/index.ts` — add 5 new actions for analysis workflows
- Generate `openclaw-skill.json` configuration template

## Security
- Same API key auth as existing agent-api (SHA-256 hashed, company-scoped)
- All queries scoped to the authenticated company
- KB updates validated before insertion

