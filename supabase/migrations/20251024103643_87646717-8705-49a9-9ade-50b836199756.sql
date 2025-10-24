-- Fix search_path for deduct_credits function
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_company_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_conversation_id UUID DEFAULT NULL
) RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  UPDATE public.companies SET credit_balance = credit_balance - p_amount
  WHERE id = p_company_id;
  INSERT INTO public.credit_usage(company_id, conversation_id, amount_used, reason)
  VALUES(p_company_id, p_conversation_id, p_amount, p_reason);
END;
$$;