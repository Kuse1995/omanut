
-- 1. Add company_id to facebook_messages
ALTER TABLE public.facebook_messages
  ADD COLUMN IF NOT EXISTS company_id uuid;

-- 2. Backfill company_id via meta_credentials.page_id
UPDATE public.facebook_messages fm
SET company_id = mc.company_id
FROM public.meta_credentials mc
WHERE fm.page_id = mc.page_id
  AND fm.company_id IS NULL;

CREATE INDEX IF NOT EXISTS facebook_messages_company_id_idx
  ON public.facebook_messages(company_id);
CREATE INDEX IF NOT EXISTS facebook_messages_page_id_idx
  ON public.facebook_messages(page_id);

-- 3. RLS: allow company members to read their messages
DROP POLICY IF EXISTS "Company members can view facebook messages" ON public.facebook_messages;
CREATE POLICY "Company members can view facebook messages"
  ON public.facebook_messages FOR SELECT
  TO authenticated
  USING (company_id IS NOT NULL AND user_has_company_access_v2(company_id));

-- 4. Create facebook_comments table
CREATE TABLE IF NOT EXISTS public.facebook_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  page_id text NOT NULL,
  post_id text,
  comment_id text NOT NULL UNIQUE,
  commenter_id text,
  commenter_name text,
  comment_text text,
  parent_comment_id text,
  is_processed boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facebook_comments_company_id_idx
  ON public.facebook_comments(company_id);
CREATE INDEX IF NOT EXISTS facebook_comments_page_id_idx
  ON public.facebook_comments(page_id);

ALTER TABLE public.facebook_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can view facebook comments" ON public.facebook_comments;
CREATE POLICY "Company members can view facebook comments"
  ON public.facebook_comments FOR SELECT
  TO authenticated
  USING (company_id IS NOT NULL AND user_has_company_access_v2(company_id));

DROP POLICY IF EXISTS "Admins can manage facebook comments" ON public.facebook_comments;
CREATE POLICY "Admins can manage facebook comments"
  ON public.facebook_comments FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "System can insert facebook comments" ON public.facebook_comments;
CREATE POLICY "System can insert facebook comments"
  ON public.facebook_comments FOR INSERT
  TO public
  WITH CHECK (true);

-- 5. Trigger: auto-fill company_id on new messages/comments from page_id
CREATE OR REPLACE FUNCTION public.fill_company_id_from_page()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.page_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM public.meta_credentials
    WHERE page_id = NEW.page_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facebook_messages_fill_company ON public.facebook_messages;
CREATE TRIGGER facebook_messages_fill_company
  BEFORE INSERT ON public.facebook_messages
  FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_page();

DROP TRIGGER IF EXISTS facebook_comments_fill_company ON public.facebook_comments;
CREATE TRIGGER facebook_comments_fill_company
  BEFORE INSERT ON public.facebook_comments
  FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_page();
