CREATE OR REPLACE FUNCTION public.user_has_company_access(company_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.company_id = company_uuid)
      OR public.user_has_company_access_v2(company_uuid);
$$;

CREATE POLICY "Members can view their companies" ON public.companies
  FOR SELECT TO authenticated USING (public.user_has_company_access_v2(id));
CREATE POLICY "Managers can update their companies" ON public.companies
  FOR UPDATE TO authenticated USING (public.has_company_role(id, 'manager'::company_role))
  WITH CHECK (public.has_company_role(id, 'manager'::company_role));

CREATE POLICY "Members can view company rows" ON public.action_items FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.action_items FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.action_items FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.action_items FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.ai_error_logs FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.ai_error_logs FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.ai_error_logs FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.ai_error_logs FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.ai_playground_sessions FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.ai_playground_sessions FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.ai_playground_sessions FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.ai_playground_sessions FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.boss_conversations FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Members can view company rows" ON public.calendar_conflicts FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "Members can view company rows" ON public.client_information FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.client_information FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.client_information FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.client_information FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.company_ai_overrides FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team managers can add company rows" ON public.company_ai_overrides FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'manager'::company_role));
CREATE POLICY "Team managers can edit company rows" ON public.company_ai_overrides FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'manager'::company_role)) WITH CHECK (public.has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Members can view company rows" ON public.company_documents FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.company_documents FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.company_documents FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.company_media FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.company_media FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.company_media FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.company_media FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.credit_usage FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "Members can view company rows" ON public.customer_segments FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.customer_segments FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.customer_segments FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.customer_segments FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.digital_product_deliveries FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.digital_product_deliveries FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.digital_product_deliveries FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.generated_images FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.generated_images FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.image_generation_feedback FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "Members can view company rows" ON public.image_generation_settings FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team managers can add company rows" ON public.image_generation_settings FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'manager'::company_role));
CREATE POLICY "Team managers can edit company rows" ON public.image_generation_settings FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'manager'::company_role)) WITH CHECK (public.has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Members can view company rows" ON public.media_delivery_status FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "Members can view company rows" ON public.payment_products FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team managers can add company rows" ON public.payment_products FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'manager'::company_role));
CREATE POLICY "Team managers can edit company rows" ON public.payment_products FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'manager'::company_role)) WITH CHECK (public.has_company_role(company_id, 'manager'::company_role));
CREATE POLICY "Team managers can remove company rows" ON public.payment_products FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Members can view company rows" ON public.payment_transactions FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can edit company rows" ON public.payment_transactions FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.quick_reply_templates FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Team contributors can add company rows" ON public.quick_reply_templates FOR INSERT TO authenticated WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can edit company rows" ON public.quick_reply_templates FOR UPDATE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role)) WITH CHECK (public.has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "Team contributors can remove company rows" ON public.quick_reply_templates FOR DELETE TO authenticated USING (public.has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Members can view company rows" ON public.reservations FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Members can view company rows" ON public.takeover_sessions FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));
CREATE POLICY "Members can view company rows" ON public.whatsapp_messages FOR SELECT TO authenticated USING (public.user_has_company_access_v2(company_id));

ALTER TABLE public.social_oauth_sessions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.social_oauth_sessions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'session';
ALTER TABLE public.social_oauth_sessions ADD COLUMN IF NOT EXISTS created_by_api_key_id uuid;
ALTER TABLE public.social_oauth_sessions ADD CONSTRAINT social_oauth_sessions_kind_check
  CHECK (kind IN ('session', 'link') AND (kind = 'link' OR user_id IS NOT NULL));