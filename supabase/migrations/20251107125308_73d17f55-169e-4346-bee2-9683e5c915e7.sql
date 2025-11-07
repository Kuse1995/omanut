-- Create storage bucket for company media
INSERT INTO storage.buckets (id, name, public) 
VALUES ('company-media', 'company-media', true);

-- Create table for company media
CREATE TABLE public.company_media (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.company_media ENABLE ROW LEVEL SECURITY;

-- RLS Policies for company_media
CREATE POLICY "Users can view their company media"
  ON public.company_media FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can upload media for their company"
  ON public.company_media FOR INSERT
  WITH CHECK (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update their company media"
  ON public.company_media FOR UPDATE
  USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can delete their company media"
  ON public.company_media FOR DELETE
  USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Admins can manage all media"
  ON public.company_media FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Storage policies for company-media bucket
CREATE POLICY "Media files are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-media');

CREATE POLICY "Users can upload their company media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'company-media' AND
    auth.uid() IN (SELECT id FROM auth.users)
  );

CREATE POLICY "Users can update their company media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'company-media' AND
    auth.uid() IN (SELECT id FROM auth.users)
  );

CREATE POLICY "Users can delete their company media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'company-media' AND
    auth.uid() IN (SELECT id FROM auth.users)
  );

-- Create trigger for updated_at
CREATE TRIGGER update_company_media_updated_at
  BEFORE UPDATE ON public.company_media
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();