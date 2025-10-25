-- Add quick reference information field to companies table
ALTER TABLE public.companies 
ADD COLUMN quick_reference_info TEXT DEFAULT '';

COMMENT ON COLUMN public.companies.quick_reference_info IS 'Quick reference information that AI can access to answer client questions';