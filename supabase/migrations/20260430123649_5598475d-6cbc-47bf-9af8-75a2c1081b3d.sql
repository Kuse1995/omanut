-- Conversations: company-member visibility
DROP POLICY IF EXISTS "Company members can view conversations" ON public.conversations;
CREATE POLICY "Company members can view conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    public.user_has_company_access_v2(company_id)
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Company members can update conversations" ON public.conversations;
CREATE POLICY "Company members can update conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    public.user_has_company_access_v2(company_id)
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Company members can insert conversations" ON public.conversations;
CREATE POLICY "Company members can insert conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_company_access_v2(company_id)
    OR public.has_role(auth.uid(), 'admin')
  );

-- Messages: visibility through parent conversation's company
DROP POLICY IF EXISTS "Company members can view messages" ON public.messages;
CREATE POLICY "Company members can view messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (
          public.user_has_company_access_v2(c.company_id)
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

DROP POLICY IF EXISTS "Company members can insert messages" ON public.messages;
CREATE POLICY "Company members can insert messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (
          public.user_has_company_access_v2(c.company_id)
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );
