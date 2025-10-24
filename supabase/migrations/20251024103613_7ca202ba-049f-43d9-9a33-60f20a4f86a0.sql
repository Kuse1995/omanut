-- Create companies table for multi-tenant support
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_type TEXT DEFAULT 'restaurant',
  voice_style TEXT DEFAULT 'Warm, polite Zambian receptionist.',
  hours TEXT DEFAULT 'Mon-Sun 10:00 – 23:00',
  menu_or_offerings TEXT DEFAULT 'Default menu / services list',
  branches TEXT DEFAULT 'Main',
  seating_areas TEXT DEFAULT 'poolside,outdoor,inside,VIP',
  currency_prefix TEXT DEFAULT 'K',
  twilio_number TEXT UNIQUE,
  credit_balance INTEGER DEFAULT 1000,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Add company_id to existing tables
ALTER TABLE public.conversations ADD COLUMN company_id UUID REFERENCES public.companies(id);
ALTER TABLE public.reservations ADD COLUMN company_id UUID REFERENCES public.companies(id);

-- Create credit usage tracking table
CREATE TABLE public.credit_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) NOT NULL,
  conversation_id UUID REFERENCES public.conversations(id),
  amount_used INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on credit_usage
ALTER TABLE public.credit_usage ENABLE ROW LEVEL SECURITY;

-- Create users table for auth
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Function to deduct credits
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_company_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_conversation_id UUID DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE public.companies SET credit_balance = credit_balance - p_amount
  WHERE id = p_company_id;
  INSERT INTO public.credit_usage(company_id, conversation_id, amount_used, reason)
  VALUES(p_company_id, p_conversation_id, p_amount, p_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies for companies (public access for now, refine later with auth)
CREATE POLICY "Public access to companies" ON public.companies FOR ALL USING (true) WITH CHECK (true);

-- Update RLS for conversations to filter by company
DROP POLICY IF EXISTS "Public access to conversations" ON public.conversations;
CREATE POLICY "Public access to conversations" ON public.conversations FOR ALL USING (true) WITH CHECK (true);

-- Update RLS for reservations to filter by company
DROP POLICY IF EXISTS "Public access to reservations" ON public.reservations;
CREATE POLICY "Public access to reservations" ON public.reservations FOR ALL USING (true) WITH CHECK (true);

-- RLS for credit_usage
CREATE POLICY "Public access to credit_usage" ON public.credit_usage FOR ALL USING (true) WITH CHECK (true);

-- RLS for users
CREATE POLICY "Public access to users" ON public.users FOR ALL USING (true) WITH CHECK (true);

-- Insert a default demo company (migrating existing agent_config data)
INSERT INTO public.companies (name, business_type, voice_style, hours, menu_or_offerings, branches, seating_areas, currency_prefix, twilio_number)
SELECT 
  'Demo Lodge',
  'restaurant',
  'Warm, polite Zambian receptionist.',
  restaurant_hours,
  menu,
  branches,
  seating_areas,
  currency_prefix,
  NULL
FROM public.agent_config
LIMIT 1;