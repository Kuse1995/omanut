-- Fix delete_company function to also delete auth users
CREATE OR REPLACE FUNCTION public.delete_company(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  -- Verify caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  -- Delete all related data in correct order (respecting foreign keys)
  DELETE FROM public.credit_usage WHERE company_id = p_company_id;
  DELETE FROM public.reservations WHERE company_id = p_company_id;
  DELETE FROM public.conversations WHERE company_id = p_company_id;
  DELETE FROM public.company_ai_overrides WHERE company_id = p_company_id;
  DELETE FROM public.company_documents WHERE company_id = p_company_id;
  
  -- Delete users from auth.users first, then public tables
  FOR v_user_id IN 
    SELECT id FROM public.users WHERE company_id = p_company_id
  LOOP
    -- Delete from auth.users (this will cascade to public.user_roles)
    DELETE FROM auth.users WHERE id = v_user_id;
  END LOOP;
  
  -- Delete from public.users (should already be cleaned up by cascade, but just in case)
  DELETE FROM public.users WHERE company_id = p_company_id;
  
  -- Finally delete the company
  DELETE FROM public.companies WHERE id = p_company_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'company_id', p_company_id,
    'message', 'Company and all related data deleted successfully'
  );
END;
$function$;

-- Create table for storing client information extracted from conversations
CREATE TABLE IF NOT EXISTS public.client_information (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  info_type text NOT NULL, -- 'preference', 'dietary', 'special_occasion', 'feedback', 'other'
  information text NOT NULL,
  importance text DEFAULT 'normal', -- 'low', 'normal', 'high'
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create table for action items and reminders
CREATE TABLE IF NOT EXISTS public.action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  action_type text NOT NULL, -- 'follow_up', 'callback', 'special_request', 'complaint', 'feedback'
  description text NOT NULL,
  priority text DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
  status text DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled'
  due_date timestamp with time zone,
  completed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.client_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for client_information
CREATE POLICY "Users can view their company client information"
  ON public.client_information FOR SELECT
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert client information for their company"
  ON public.client_information FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their company client information"
  ON public.client_information FOR UPDATE
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their company client information"
  ON public.client_information FOR DELETE
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- RLS policies for action_items
CREATE POLICY "Users can view their company action items"
  ON public.action_items FOR SELECT
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert action items for their company"
  ON public.action_items FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their company action items"
  ON public.action_items FOR UPDATE
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their company action items"
  ON public.action_items FOR DELETE
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Indexes for performance
CREATE INDEX idx_client_information_company ON public.client_information(company_id);
CREATE INDEX idx_client_information_phone ON public.client_information(customer_phone);
CREATE INDEX idx_action_items_company ON public.action_items(company_id);
CREATE INDEX idx_action_items_status ON public.action_items(status);
CREATE INDEX idx_action_items_priority ON public.action_items(priority);

-- Triggers for updated_at
CREATE TRIGGER update_client_information_updated_at
  BEFORE UPDATE ON public.client_information
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_action_items_updated_at
  BEFORE UPDATE ON public.action_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();