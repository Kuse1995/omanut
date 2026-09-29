-- ZamCash Loans - attach images to the posts that are still upcoming.
-- Batch 1 was scheduled before image URLs existed, so its posts were text-only.
-- This attaches:
--   * ChatGPT-2.5 (gpt-image-2.5 flare) photoreal people shots for human scenes
--   * the proven text posters (K500-K600, HOW TO APPLY, NEVER PAY A DEPOSIT,
--     APPLY ON YOUR PHONE) from the earlier set, which rendered cleanly
-- and upgrades batch 2's people images to the new model too.
-- Only posts that have not published yet are touched (status stays 'approved').

DO $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT id INTO v_company_id FROM public.companies WHERE name = 'ZamCash Loans' LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'ZamCash Loans company not found';
  END IF;

  -- batch 1: fill the missing images
  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/807d2b4c-30af-4bc0-9b7d-bb24e8cbcec7.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Your phone is all you need%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/d44b45a0-c7b9-448e-8c79-f22b3c2359f6.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%K500 cash, repay K600 after 14 days%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/c2117d41-4ffd-4f89-b016-0e3b0daef5a6.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Airtel, MTN or Zamtel%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/af81736b-7eb7-4d04-b535-5b0e44e94b8e.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%How to apply in 3 steps%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/1967720c-2669-4af4-9add-103459ea4113.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Emergency, stock for the shop%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/7635e3f7-d06f-4c80-8aac-33af59d20bd3.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Never pay a deposit%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/576989db-1505-449c-9972-65cbaae6678f.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%No paperwork. No queues%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/9efe7a86-4985-4987-8fb9-edea319128de.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Loan approval is decided by ZamCash%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/f4b54834-f9fc-467e-92c4-b4d7f13ea686.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Don''t get caught short%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/10b8ddbc-0520-457b-ab45-8620761b8f56.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%You''ve been in a relationship with us%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/b67c2376-0f03-424a-98a5-b4f6ea1ab06f.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Who is still with us%' AND image_url IS NULL;

  UPDATE public.scheduled_posts
  SET image_url = $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/95990d76-e406-4680-a12f-763c24cd53c7.png$img$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%One thing you hate about us%' AND image_url IS NULL;

  -- batch 2: upgrade the people images to the new engine
  UPDATE public.scheduled_posts
  SET image_url = $up$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/10b8ddbc-0520-457b-ab45-8620761b8f56.png$up$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%You''ve been in a relationship with us%';

  UPDATE public.scheduled_posts
  SET image_url = $up$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/b67c2376-0f03-424a-98a5-b4f6ea1ab06f.png$up$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%Who is still with us%';

  UPDATE public.scheduled_posts
  SET image_url = $up$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/95990d76-e406-4680-a12f-763c24cd53c7.png$up$::text, updated_at = now()
  WHERE company_id = v_company_id AND content LIKE '%One thing you hate about us%';

  RAISE NOTICE 'ZamCash Loans: post images attached/upgraded';
END $$;
