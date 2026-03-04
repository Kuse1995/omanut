

## Plan: Add Meta Integrations (Facebook/Instagram) Tab

### 1. Database Migration

Create `meta_credentials` table:

```sql
CREATE TABLE public.meta_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  access_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  ai_system_prompt text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.meta_credentials ENABLE ROW LEVEL SECURITY;

-- Users can CRUD their own credentials
CREATE POLICY "Users can view own meta credentials" ON public.meta_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own meta credentials" ON public.meta_credentials
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own meta credentials" ON public.meta_credentials
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own meta credentials" ON public.meta_credentials
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Platform admins full access
CREATE POLICY "Admins full access to meta credentials" ON public.meta_credentials
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));
```

### 2. Add Sidebar Nav Item

In `AdminIconSidebar.tsx`, add a new nav item:
```ts
{ id: 'meta-integrations', icon: Share2, label: 'Meta Integrations' }
```

### 3. Create MetaIntegrationsPanel Component

New file: `src/components/admin/MetaIntegrationsPanel.tsx`

A form with:
- **Platform** select (Facebook / Instagram)
- **Page ID** text input
- **Access Token** password input
- **AI System Prompt** textarea
- Save button that upserts to `meta_credentials`
- List of existing saved credentials with edit/delete

Uses `useQuery` to load existing credentials and `useMutation` to save/delete.

### 4. Wire into AdminContentTabs

Add `case 'meta-integrations'` in `AdminContentTabs.tsx` rendering `<MetaIntegrationsPanel />`.

### Files to Create/Modify
- **New migration** -- `meta_credentials` table + RLS
- **New component** -- `src/components/admin/MetaIntegrationsPanel.tsx`
- **Edit** `src/components/admin/AdminIconSidebar.tsx` -- add nav item
- **Edit** `src/components/admin/AdminContentTabs.tsx` -- add case

