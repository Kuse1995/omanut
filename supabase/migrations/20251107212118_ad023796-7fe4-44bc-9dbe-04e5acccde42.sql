-- Add payment proof and verification fields to payment_transactions
ALTER TABLE public.payment_transactions
ADD COLUMN payment_proof_url text,
ADD COLUMN payment_proof_uploaded_at timestamp with time zone,
ADD COLUMN designated_number text,
ADD COLUMN verification_status text DEFAULT 'pending',
ADD COLUMN verified_by uuid REFERENCES auth.users(id),
ADD COLUMN verified_at timestamp with time zone,
ADD COLUMN admin_notes text;

-- Add designated payment numbers to companies
ALTER TABLE public.companies
ADD COLUMN payment_number_mtn text,
ADD COLUMN payment_number_airtel text,
ADD COLUMN payment_number_zamtel text,
ADD COLUMN payment_instructions text DEFAULT 'Send payment to the designated number and upload proof of payment for verification.';

-- Create storage bucket for payment proofs
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for payment-proofs bucket
CREATE POLICY "Authenticated users can upload payment proofs"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'payment-proofs' AND
  auth.role() = 'authenticated'
);

CREATE POLICY "Users can view payment proofs for their company"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'payment-proofs' AND
  (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
    )
    OR auth.role() = 'anon'
  )
);

CREATE POLICY "Admins can delete payment proofs"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'payment-proofs' AND
  has_role(auth.uid(), 'admin')
);

-- Update RLS for payment_transactions to allow system updates
CREATE POLICY "System can update payment transactions"
ON public.payment_transactions FOR UPDATE
USING (true)
WITH CHECK (true);