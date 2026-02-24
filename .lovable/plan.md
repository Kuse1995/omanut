

# Plan: AI-Powered Support Ticket System

## Overview
Add a customer service ticketing system where the AI automatically creates support tickets during WhatsApp conversations. The AI collects the customer's name, describes their issue, recommends the appropriate department/employee, and sends personalized service recommendations -- all via tool calling within the existing multi-agent architecture.

---

## What This Enables

- **Automatic ticket creation**: When a customer reports an issue via WhatsApp, the AI collects their details and creates a structured ticket
- **Smart department routing**: AI analyzes the issue and recommends which department (Billing, Technical, Sales, HR, etc.) or specific employee should handle it
- **Service recommendations**: AI proactively suggests relevant services or solutions based on the customer's issue
- **Ticket management dashboard**: Admins can view, assign, update, and resolve tickets from a new "Tickets" tab in the admin panel
- **External API access**: The `agent-api` edge function gains `list_tickets`, `create_ticket`, and `update_ticket` actions

---

## Implementation Steps

### Step 1: Database -- Create `support_tickets` Table

New table to store tickets:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| company_id | uuid | FK to companies |
| conversation_id | uuid | FK to conversations (nullable) |
| ticket_number | text | Human-readable ID (e.g., TKT-001) |
| customer_name | text | Collected by AI |
| customer_phone | text | From WhatsApp conversation |
| customer_email | text | Collected by AI (nullable) |
| issue_summary | text | AI-generated summary of the issue |
| issue_category | text | AI-classified category (billing, technical, general, etc.) |
| recommended_department | text | AI recommendation |
| recommended_employee | text | AI recommendation (nullable) |
| service_recommendations | jsonb | Array of suggested services/solutions |
| priority | text | low / medium / high / urgent |
| status | text | open / in_progress / waiting / resolved / closed |
| assigned_to | text | Employee/department actually assigned |
| resolution_notes | text | How it was resolved |
| created_at | timestamptz | When ticket was created |
| updated_at | timestamptz | Last update |
| resolved_at | timestamptz | When resolved |

Also create a `company_departments` table for configurable departments:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| company_id | uuid | FK to companies |
| name | text | Department name |
| description | text | What this department handles |
| contact_info | text | Email/phone for the department |
| employees | jsonb | Array of employee names/roles |
| is_active | boolean | Whether department is available |

RLS: Company owners/managers can manage; contributors/viewers can read.

### Step 2: New AI Tool -- `create_support_ticket`

Add a new tool definition to `whatsapp-messages/index.ts`:

```text
Tool: create_support_ticket
Description: Creates a support ticket when a customer reports an issue.
             Collect the customer's name and issue details before calling.
             AI should classify the issue and recommend a department.
Parameters:
  - customer_name (required): Customer's full name
  - issue_summary (required): Clear description of the issue
  - issue_category (required): billing | technical | account | product | 
                                general | complaint | feature_request
  - priority (required): low | medium | high | urgent
  - recommended_department (optional): AI's recommendation
  - recommended_employee (optional): Specific person if known
  - service_recommendations (optional): Array of suggested solutions
```

The tool handler will:
1. Insert the ticket into `support_tickets`
2. Auto-generate a ticket number (TKT-XXX)
3. If priority is "urgent" or "high", notify the boss via the existing `notify_boss` mechanism
4. Return the ticket number to the AI so it can confirm to the customer

### Step 3: New AI Tool -- `recommend_services`

Add a tool that looks up relevant services/products based on the customer's issue:

```text
Tool: recommend_services
Description: Search company products and knowledge base to find
             relevant services for the customer's issue.
Parameters:
  - issue_description (required): What the customer needs help with
  - category (optional): Filter by category
```

The tool handler queries `payment_products`, `quick_reference_info`, and `company_documents` to find relevant matches and returns formatted recommendations.

### Step 4: Update Tool Filtering and System Prompt

- Add `create_support_ticket` and `recommend_services` to the `allToolDefinitions` map in `whatsapp-messages/index.ts`
- Add them to the `AVAILABLE_TOOLS` list in `ToolControlPanel.tsx` under a new "Support" category
- Add them to the default `enabled_tools` array in the database for customer service companies
- Enhance the support agent's system prompt to instruct it to:
  1. Always collect the customer's name before creating a ticket
  2. Classify the issue category based on conversation context
  3. Recommend the appropriate department using available `company_departments` data
  4. Proactively suggest relevant services using `recommend_services`

### Step 5: Admin UI -- Tickets Panel

Create a new `TicketsPanel.tsx` component with:

- **Ticket list**: Filterable by status, priority, department, date range
- **Ticket detail view**: Shows full issue, conversation link, AI recommendations
- **Assignment**: Dropdown to assign to a department/employee
- **Status updates**: Move tickets through the workflow (open -> in_progress -> resolved -> closed)
- **Department management**: Configure departments and employees per company

Add a "Tickets" tab to `AdminIconSidebar.tsx` and `AdminContentTabs.tsx`.

### Step 6: Update `agent-api` Gateway

Add three new actions to the external agent API:

- `list_tickets` -- Query tickets with filters (status, priority, date)
- `create_ticket` -- Create a ticket programmatically
- `update_ticket` -- Update status, assignment, resolution notes

---

## Technical Details

### Ticket Creation Flow

```text
Customer WhatsApp Message: "I have a billing problem"
        |
  AI classifies as support issue
        |
  AI asks: "I'd like to help! Could you tell me your name 
           and describe the billing issue?"
        |
  Customer: "I'm John, I was charged twice for my subscription"
        |
  AI calls create_support_ticket:
    - customer_name: "John"
    - issue_summary: "Customer charged twice for subscription"
    - issue_category: "billing"
    - priority: "high"
    - recommended_department: "Billing"
        |
  AI calls recommend_services:
    - issue_description: "double charge on subscription"
        |
  AI responds: "I've created ticket TKT-042 for you, John. 
               Our Billing team will review the double charge.
               In the meantime, you can check your payment 
               history at [link]. Expected resolution: 24-48hrs."
```

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| Migration SQL | Create | `support_tickets` and `company_departments` tables with RLS |
| `supabase/functions/whatsapp-messages/index.ts` | Modify | Add `create_support_ticket` and `recommend_services` tool definitions + handlers |
| `supabase/functions/agent-api/index.ts` | Modify | Add `list_tickets`, `create_ticket`, `update_ticket` actions |
| `src/components/admin/TicketsPanel.tsx` | Create | Ticket management dashboard |
| `src/components/admin/DepartmentManager.tsx` | Create | Department configuration UI |
| `src/components/admin/AdminContentTabs.tsx` | Modify | Add "tickets" case |
| `src/components/admin/AdminIconSidebar.tsx` | Modify | Add Ticket icon to nav |
| `src/components/admin/deep-settings/ToolControlPanel.tsx` | Modify | Add new tools to AVAILABLE_TOOLS list |

### Department Routing Logic

The AI determines the recommended department by:
1. Loading `company_departments` for the company
2. Matching the issue category and keywords against department descriptions
3. If no match, defaulting to "General Support"
4. Including the department list in the system prompt so the AI can make informed routing decisions

