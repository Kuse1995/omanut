-- Create customer segments table
CREATE TABLE IF NOT EXISTS public.customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  
  -- Engagement metrics
  engagement_score INTEGER DEFAULT 0 CHECK (engagement_score >= 0 AND engagement_score <= 100),
  engagement_level TEXT DEFAULT 'low' CHECK (engagement_level IN ('low', 'medium', 'high')),
  total_conversations INTEGER DEFAULT 0,
  avg_response_time_seconds INTEGER DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  
  -- Intent analysis
  intent_category TEXT DEFAULT 'unknown' CHECK (intent_category IN ('unknown', 'browsing', 'interested', 'ready_to_buy', 'support')),
  intent_score INTEGER DEFAULT 0 CHECK (intent_score >= 0 AND intent_score <= 100),
  detected_interests TEXT[],
  
  -- Conversion potential
  conversion_potential TEXT DEFAULT 'low' CHECK (conversion_potential IN ('low', 'medium', 'high', 'very_high')),
  conversion_score INTEGER DEFAULT 0 CHECK (conversion_score >= 0 AND conversion_score <= 100),
  has_reservation BOOLEAN DEFAULT FALSE,
  has_payment BOOLEAN DEFAULT FALSE,
  total_spend DECIMAL(10,2) DEFAULT 0,
  
  -- Segment classification
  segment_type TEXT DEFAULT 'cold_lead' CHECK (segment_type IN (
    'cold_lead', 'warm_lead', 'hot_lead', 
    'active_customer', 'vip_customer', 
    'at_risk', 'dormant', 'lost'
  )),
  
  -- Metadata
  analysis_notes TEXT,
  last_analyzed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(company_id, customer_phone)
);

-- Enable RLS
ALTER TABLE public.customer_segments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their company customer segments"
  ON public.customer_segments FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert their company customer segments"
  ON public.customer_segments FOR INSERT
  WITH CHECK (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update their company customer segments"
  ON public.customer_segments FOR UPDATE
  USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can delete their company customer segments"
  ON public.customer_segments FOR DELETE
  USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

-- Create index for performance
CREATE INDEX idx_customer_segments_company_phone ON public.customer_segments(company_id, customer_phone);
CREATE INDEX idx_customer_segments_segment_type ON public.customer_segments(company_id, segment_type);
CREATE INDEX idx_customer_segments_conversion_potential ON public.customer_segments(company_id, conversion_potential);

-- Create trigger for updated_at
CREATE TRIGGER update_customer_segments_updated_at
  BEFORE UPDATE ON public.customer_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();