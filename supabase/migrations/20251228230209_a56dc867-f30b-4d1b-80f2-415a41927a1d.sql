-- Create table to track image generation feedback for learning
CREATE TABLE public.image_generation_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  generated_image_id UUID REFERENCES public.generated_images(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  enhanced_prompt TEXT,
  image_url TEXT NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  feedback_type TEXT CHECK (feedback_type IN ('thumbs_up', 'thumbs_down', 'used', 'shared', 'edited')),
  feedback_notes TEXT,
  caption_suggestion TEXT,
  caption_used BOOLEAN DEFAULT false,
  posting_time_suggestion TIMESTAMPTZ,
  was_posted BOOLEAN DEFAULT false,
  posted_at TIMESTAMPTZ,
  engagement_score INTEGER,
  learned_preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for company lookups
CREATE INDEX idx_image_generation_feedback_company ON public.image_generation_feedback(company_id);
CREATE INDEX idx_image_generation_feedback_rating ON public.image_generation_feedback(company_id, rating) WHERE rating IS NOT NULL;

-- Enable RLS
ALTER TABLE public.image_generation_feedback ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "System can insert feedback"
ON public.image_generation_feedback
FOR INSERT
WITH CHECK (true);

CREATE POLICY "System can update feedback"
ON public.image_generation_feedback
FOR UPDATE
USING (true);

CREATE POLICY "Users can view their company feedback"
ON public.image_generation_feedback
FOR SELECT
USING (company_id IN (
  SELECT users.company_id FROM users WHERE users.id = auth.uid()
));

CREATE POLICY "Admins can manage all feedback"
ON public.image_generation_feedback
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_image_generation_feedback_updated_at
BEFORE UPDATE ON public.image_generation_feedback
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add style_learned column to image_generation_settings for storing learned preferences
ALTER TABLE public.image_generation_settings 
ADD COLUMN IF NOT EXISTS learned_style_preferences JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS top_performing_prompts TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS best_posting_times TEXT[] DEFAULT '{}';