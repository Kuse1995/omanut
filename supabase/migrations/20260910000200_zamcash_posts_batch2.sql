-- ZamCash Loans - 9 additional posts in the page's own voice (batch 2).
-- Times differ from batch 1 (09:00 / 17:00 CAT): 07:15, 12:30, 15:45, 18:45, 20:15.
-- Voice modelled on the page's top-performing posts (humour, Zambian slang,
-- defaulters roast, faith, tag-a-friend, engagement questions), each carrying
-- the owner's referral link. Text-only where the page's best posts were text-only.

DO $$
DECLARE
  v_company_id uuid;
  v_page_id text;
  v_created_by uuid;
BEGIN
  SELECT id INTO v_company_id FROM public.companies WHERE name = 'ZamCash Loans' LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'ZamCash Loans company not found';
  END IF;

  SELECT page_id INTO v_page_id FROM public.meta_credentials WHERE company_id = v_company_id LIMIT 1;
  IF v_page_id IS NULL THEN
    RAISE EXCEPTION 'No Facebook page connected to ZamCash Loans yet';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.scheduled_posts sp
    WHERE sp.company_id = v_company_id
      AND sp.content LIKE '%pindaling nkongole%'
  ) THEN
    RAISE NOTICE 'ZamCash batch 2 already scheduled - nothing to do';
    RETURN;
  END IF;

  SELECT created_by INTO v_created_by FROM public.scheduled_posts ORDER BY created_at ASC LIMIT 1;
  IF v_created_by IS NULL THEN
    SELECT id INTO v_created_by FROM auth.users ORDER BY created_at ASC LIMIT 1;
  END IF;

  INSERT INTO public.scheduled_posts (company_id, page_id, content, scheduled_time, status, created_by, image_url)
  VALUES
      (v_company_id, v_page_id, $p$Tag your friend who is good at pindaling nkongole... we hire him 🤝

Loans from K500 - apply on your phone in 2 minutes
👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '1 day' + interval '10 hour' + interval '30 minute'), 'approved', v_created_by, $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/ed53522d-2156-497e-9003-50f7ebebda2f.png$img$::text),
      (v_company_id, v_page_id, $p$5 years you havent paid back a K200 loan. God bless you 🙏

If you are new and serious: K500, repay K600 after 14 days
👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '1 day' + interval '18 hour' + interval '15 minute'), 'approved', v_created_by, null),
      (v_company_id, v_page_id, $p$Goodnight to our VIP customers 😍 The rest of you can get your goodnight from fikiliza 😒

K500 into your mobile money, no paperwork
👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '2 day' + interval '5 hour' + interval '15 minute'), 'approved', v_created_by, null),
      (v_company_id, v_page_id, $p$You've been in a relationship with us longer than your last 2 boyfriends. Respect the bond 😅

New here? Start with K500
👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '2 day' + interval '13 hour' + interval '45 minute'), 'approved', v_created_by, $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/a588d845-3ded-4725-97b5-fd876fcb40c3.png$img$::text),
      (v_company_id, v_page_id, $p$Others didn't wake up. Thank God for the gift of life today ❤️

And if you need a quick loan, we are open 24/7
👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '3 day' + interval '10 hour' + interval '30 minute'), 'approved', v_created_by, null),
      (v_company_id, v_page_id, $p$Who is still with us? 👀

K500 straight to mobile money - 2 minutes to apply
👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '3 day' + interval '16 hour' + interval '45 minute'), 'approved', v_created_by, $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/e8da472f-770e-423a-9531-cd518eba3206.png$img$::text),
      (v_company_id, v_page_id, $p$The way you ask for the ka link 😂 Here it is:
👉 https://zamcash.com/invite/812531

K500, repay K600 after 14 days. Read your terms before you accept 🙏$p$::text, (date_trunc('day', now()) + interval '4 day' + interval '5 hour' + interval '15 minute'), 'approved', v_created_by, null),
      (v_company_id, v_page_id, $p$One thing you hate about us? Tell us in the comments 😅
We will fix everything except the repayment date 😂

Apply here 👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '4 day' + interval '18 hour' + interval '15 minute'), 'approved', v_created_by, $img$https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/generated/10873fee-3fea-4238-b3b5-6d74e360f4b0/9e9bcb93-04cc-4e6e-8418-c0cbd73cea46.png$img$::text),
      (v_company_id, v_page_id, $p$Mwamona? Kwaliba cyber security kunkongole? 😂

Apply properly - Airtel, MTN or Zamtel. Never pay a deposit to an agent
👉 https://zamcash.com/invite/812531$p$::text, (date_trunc('day', now()) + interval '5 day' + interval '13 hour' + interval '45 minute'), 'approved', v_created_by, null);

  RAISE NOTICE 'ZamCash Loans: 9 batch-2 posts scheduled';
END $$;
