
-- Create scheduled_posts table
CREATE TABLE public.scheduled_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  content text NOT NULL,
  scheduled_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  meta_post_id text,
  error_message text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Company members can view scheduled posts"
  ON public.scheduled_posts FOR SELECT
  TO authenticated
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "Contributors can create scheduled posts"
  ON public.scheduled_posts FOR INSERT
  TO authenticated
  WITH CHECK (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Contributors can update scheduled posts"
  ON public.scheduled_posts FOR UPDATE
  TO authenticated
  USING (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Owners can delete scheduled posts"
  ON public.scheduled_posts FOR DELETE
  TO authenticated
  USING (has_company_role(company_id, 'owner'::company_role));

CREATE POLICY "Platform admins full access to scheduled posts"
  ON public.scheduled_posts FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
