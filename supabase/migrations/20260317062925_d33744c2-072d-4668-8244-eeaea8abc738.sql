CREATE TABLE public.video_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  operation_name text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  prompt text,
  aspect_ratio text DEFAULT '9:16',
  boss_phone text NOT NULL,
  video_url text,
  error_message text,
  scheduled_post_data jsonb,
  poll_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.video_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on video_generation_jobs"
  ON public.video_generation_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);