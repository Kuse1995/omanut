

# Plan: API Key System for External AI Agent Access

## Overview
Create a secure API key system that allows external AI agents to interact with the platform programmatically. Each API key is scoped to a specific company and grants full access to that company's data and capabilities (messaging, reservations, payments, media, etc.).

## What This Enables
- An external AI agent can authenticate via an API key (in the `x-api-key` header) instead of a user JWT
- The agent can send WhatsApp messages, manage reservations, query conversations, access customer data, and more -- all scoped to the company the key belongs to
- Keys can be created, viewed, and revoked from the admin dashboard

---

## Implementation Steps

### Step 1: Create `company_api_keys` Table

New database table to store hashed API keys:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| company_id | uuid | FK to companies |
| key_hash | text | SHA-256 hash of the key (never store plaintext) |
| key_prefix | text | First 8 chars for display (e.g., `oai_abc1...`) |
| name | text | Human-readable label |
| scopes | text[] | Reserved for future granular permissions (default: `{*}`) |
| is_active | boolean | Soft revoke |
| last_used_at | timestamptz | Track usage |
| created_by | uuid | Who created it |
| created_at | timestamptz | When |
| expires_at | timestamptz | Optional expiry |

RLS: Only platform admins and company owners/managers can manage keys.

### Step 2: Create Edge Function `manage-api-keys`

Handles key lifecycle:
- **POST** `/manage-api-keys` with `action: "create"` -- generates a random key, stores the hash, returns the plaintext key **once**
- **POST** with `action: "list"` -- returns key metadata (prefix, name, active, last used)
- **POST** with `action: "revoke"` -- sets `is_active = false`

Authentication: Requires JWT from an admin/owner/manager.

### Step 3: Create Edge Function `agent-api`

The main API gateway for external agents. Authenticates via `x-api-key` header, looks up the company, then routes to the requested action.

Supported actions:
- `send_message` -- Send a WhatsApp message to a customer
- `list_conversations` -- Get recent conversations
- `get_conversation` -- Get messages for a conversation
- `list_reservations` -- Get reservations
- `create_reservation` -- Create a reservation
- `list_products` -- Get payment products
- `list_customers` -- Get customer segments
- `get_company_info` -- Get company details
- `list_media` -- Get available media
- `get_analytics` -- Get conversation/payment stats

Each action queries the database scoped to the API key's `company_id`.

### Step 4: Admin UI -- API Keys Section

Add an "API Keys" section to `CompanySettingsPanel.tsx`:
- Button to generate a new key (shows plaintext once in a dialog with copy button)
- Table of existing keys showing prefix, name, status, last used
- Revoke button per key
- Warning that keys grant full access

---

## Technical Details

### Security Model

```text
External Agent Request Flow:

Agent --> x-api-key: oai_abc123... --> agent-api Edge Function
                                          |
                                    Hash the key (SHA-256)
                                          |
                                    Lookup in company_api_keys
                                          |
                                    Verify is_active = true
                                    Verify not expired
                                          |
                                    Extract company_id
                                          |
                                    Execute action scoped to company
                                          |
                                    Update last_used_at
                                          |
                                    Return JSON response
```

- Keys are prefixed with `oai_` for easy identification
- Plaintext is shown only once at creation; only the hash is stored
- `verify_jwt = false` on `agent-api` since it uses API key auth
- `verify_jwt = false` on `manage-api-keys` with manual JWT validation in code
- All database queries use `SUPABASE_SERVICE_ROLE_KEY` but are manually scoped to the key's `company_id`
- Security events are logged for key creation, usage, and revocation

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| Migration SQL | Create | `company_api_keys` table with RLS |
| `supabase/functions/manage-api-keys/index.ts` | Create | Key lifecycle management |
| `supabase/functions/agent-api/index.ts` | Create | External agent gateway |
| `supabase/config.toml` | Modify | Add both new functions with `verify_jwt = false` |
| `src/components/admin/CompanySettingsPanel.tsx` | Modify | Add API Keys management UI |

### API Key Format
- Generated as: `oai_` + 48 random hex characters
- Example: `oai_a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3`
- Stored as: SHA-256 hash of the full key
- Displayed as: `oai_a3f8b2c1...` (prefix only)

### Example Agent Usage

```text
curl -X POST https://dzheddvoiauevcayifev.supabase.co/functions/v1/agent-api \
  -H "x-api-key: oai_a3f8b2c1..." \
  -H "Content-Type: application/json" \
  -d '{"action": "send_message", "params": {"phone": "+260...", "message": "Hello!"}}'
```

