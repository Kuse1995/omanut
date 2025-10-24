-- Add metadata column for flexible business-specific data
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Create GIN index for fast JSONB queries
CREATE INDEX IF NOT EXISTS idx_companies_metadata ON public.companies USING GIN (metadata);

-- Add updated_at trigger for companies
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_companies_updated_at 
    BEFORE UPDATE ON public.companies 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Update companies table to ensure it has updated_at column
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();