-- Create storage bucket for company documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-documents', 'company-documents', false);

-- Create company_documents table
CREATE TABLE public.company_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  parsed_content TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on company_documents
ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for company_documents
CREATE POLICY "Admins can manage all documents"
ON public.company_documents
FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their company documents"
ON public.company_documents
FOR SELECT
USING (company_id IN (
  SELECT company_id FROM public.users WHERE id = auth.uid()
));

CREATE POLICY "Users can upload documents for their company"
ON public.company_documents
FOR INSERT
WITH CHECK (company_id IN (
  SELECT company_id FROM public.users WHERE id = auth.uid()
));

CREATE POLICY "Users can delete their company documents"
ON public.company_documents
FOR DELETE
USING (company_id IN (
  SELECT company_id FROM public.users WHERE id = auth.uid()
));

-- Storage policies for company-documents bucket
CREATE POLICY "Users can upload documents for their company"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'company-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their company documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'company-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their company documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'company-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Admins can manage all documents in storage"
ON storage.objects
FOR ALL
USING (bucket_id = 'company-documents' AND has_role(auth.uid(), 'admin'));

-- Add trigger for updated_at
CREATE TRIGGER update_company_documents_updated_at
BEFORE UPDATE ON public.company_documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();