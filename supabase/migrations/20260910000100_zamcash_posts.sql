-- ZamCash Loans — 10 scheduled posts across 5 days (2 per day, 09:00 and 17:00 CAT).
-- Step 2 of 2: RUN THIS ONLY AFTER the ZamCash Facebook page is connected to the
-- 'ZamCash Loans' company (the posts need that page's id to publish).
-- If the page is not connected yet, this migration fails loudly instead of
-- creating unpublishable rows - connect the page and re-run it.

DO $$
DECLARE
  v_company_id uuid;
  v_page_id text;
  v_created_by uuid;
BEGIN
  SELECT id INTO v_company_id FROM public.companies WHERE name = 'ZamCash Loans' LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'ZamCash Loans company not found - run 20260910000000_zamcash_company.sql first';
  END IF;

  SELECT page_id INTO v_page_id FROM public.meta_credentials WHERE company_id = v_company_id LIMIT 1;
  IF v_page_id IS NULL THEN
    RAISE EXCEPTION 'No Facebook page connected to ZamCash Loans yet. Connect the ZamCash page in the console, then run this migration again.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.scheduled_posts WHERE company_id = v_company_id) THEN
    RAISE NOTICE 'ZamCash Loans already has scheduled posts - nothing to do';
    RETURN;
  END IF;

  -- Creator: reuse an existing post author (the owner account) when available.
  SELECT created_by INTO v_created_by FROM public.scheduled_posts ORDER BY created_at ASC LIMIT 1;
  IF v_created_by IS NULL THEN
    SELECT id INTO v_created_by FROM auth.users ORDER BY created_at ASC LIMIT 1;
  END IF;

  INSERT INTO public.scheduled_posts (company_id, page_id, content, scheduled_time, status, created_by)
  VALUES
      (v_company_id, v_page_id, $p$Need quick cash? Apply for a ZamCash loan on your phone - no paperwork, no bank queue. It takes about 2 minutes.

Apply here 👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '1 day' + interval '7 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$Your phone is all you need. Apply for ZamCash online and the money is sent to your mobile money once approved.

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '1 day' + interval '15 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$K500 cash, repay K600 after 14 days. Simple and straight.

Always read the repayment terms in the app before you accept the loan. 👍

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '2 day' + interval '7 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$Airtel, MTN or Zamtel - use the number you already have. Apply in minutes.

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '2 day' + interval '15 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$How to apply in 3 steps:
1. Open the link
2. Enter your mobile number
3. Follow the verification

That's it. 👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '3 day' + interval '7 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$Emergency, stock for the shop, or school fees? ZamCash is open 24/7, online.

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '3 day' + interval '15 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$⚠️ Never pay a deposit or "registration fee" to anyone for a ZamCash loan. Apply only through the official link.

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '4 day' + interval '7 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$No paperwork. No queues. 100% mobile application - money straight to your mobile money if approved.

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '4 day' + interval '15 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$Loan approval is decided by ZamCash - but applying takes about 2 minutes. See what you qualify for.

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '5 day' + interval '7 hour' + interval '0 minute'), 'approved', v_created_by),
      (v_company_id, v_page_id, $p$Don't get caught short this month. Apply today and get an answer fast. Read your repayment terms first. 🙏

👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '5 day' + interval '15 hour' + interval '0 minute'), 'approved', v_created_by);

  RAISE NOTICE 'ZamCash Loans: 10 posts scheduled across 5 days';
END $$;
