-- Extend generated_images with approval workflow
ALTER TABLE public.generated_images
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS rejected_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS rejection_reason text,
ADD COLUMN IF NOT EXISTS brand_assets_used uuid[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS generation_params jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Add constraint for valid status values
ALTER TABLE public.generated_images
ADD CONSTRAINT generated_images_status_check 
CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected'));

-- Extend image_generation_settings with brand profile
ALTER TABLE public.image_generation_settings
ADD COLUMN IF NOT EXISTS brand_colors jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS brand_fonts jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS brand_tone text,
ADD COLUMN IF NOT EXISTS visual_guidelines text,
ADD COLUMN IF NOT EXISTS reference_asset_ids uuid[] DEFAULT '{}';

-- Create index for faster draft queries
CREATE INDEX IF NOT EXISTS idx_generated_images_status ON public.generated_images(company_id, status);
CREATE INDEX IF NOT EXISTS idx_generated_images_approval ON public.generated_images(company_id, approved_at);

-- Update RLS policies for generated_images to support approval workflow

-- Drop existing policies that may conflict
DROP POLICY IF EXISTS "Users can insert generated images for their company" ON public.generated_images;
DROP POLICY IF EXISTS "Users can view their company's generated images" ON public.generated_images;
DROP POLICY IF EXISTS "Admins can view all generated images" ON public.generated_images;

-- New policies with role-based approval

-- Anyone in company can view drafts and approved images
CREATE POLICY "Company members can view generated images"
ON public.generated_images
FOR SELECT
USING (user_has_company_access(company_id));

-- Anyone in company can create drafts
CREATE POLICY "Company members can create draft images"
ON public.generated_images
FOR INSERT
WITH CHECK (
  user_has_company_access(company_id) 
  AND status = 'draft'
);

-- Only owners/managers can approve/reject (update status)
CREATE POLICY "Managers can update image status"
ON public.generated_images
FOR UPDATE
USING (
  has_company_role(company_id, 'owner'::company_role) 
  OR has_company_role(company_id, 'manager'::company_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Only owners can delete images
CREATE POLICY "Owners can delete images"
ON public.generated_images
FOR DELETE
USING (
  has_company_role(company_id, 'owner'::company_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Platform admins full access
CREATE POLICY "Platform admins full access to generated images"
ON public.generated_images
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_generated_images_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_generated_images_updated_at ON public.generated_images;
CREATE TRIGGER update_generated_images_updated_at
BEFORE UPDATE ON public.generated_images
FOR EACH ROW
EXECUTE FUNCTION public.update_generated_images_updated_at();