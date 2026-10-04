-- 20260910000600_zamcash_week_posts.sql
--
-- ZamCash Loans - the week of Mon 5 Oct to Sun 11 Oct 2026, 2 posts a day at
-- varied times (all stored UTC; Zambia is CAT = UTC+2).
--
-- Creative direction taken from the page's own numbers: the top three posts are
-- all text-only ("5 years you havent paid back a K200 loan" 67 reactions /
-- 26 comments; "If you always pay back say hi" 20 / 41; "Tag your friend who is
-- good at pindaling nkongole" 13 / 18) while photo posts sit in single digits.
-- So this batch is mostly text in the page's own voice, with images reserved for
-- the posts where a visual actually carries the offer.
--
-- Also flips companies.agent_takeover_enabled for ZamCash Loans: the column is
-- NOT NULL DEFAULT false and only companies created before the 2026-09-03
-- backfills have it set, which is why the AI agent cannot generate images for
-- ZamCash ("AI Agent takeover is disabled for ZamCash Loans").

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

  UPDATE public.companies SET agent_takeover_enabled = true WHERE id = v_company_id;

  SELECT page_id INTO v_page_id FROM public.meta_credentials WHERE company_id = v_company_id LIMIT 1;
  IF v_page_id IS NULL THEN
    RAISE EXCEPTION 'No Facebook page connected to ZamCash Loans yet';
  END IF;

  SELECT created_by INTO v_created_by FROM public.scheduled_posts WHERE company_id = v_company_id ORDER BY created_at ASC LIMIT 1;
  IF v_created_by IS NULL THEN
    SELECT id INTO v_created_by FROM auth.users ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- Past slots are skipped (so running this late never dumps old posts at once)
  -- and matching captions are skipped, so re-running is a no-op.
  INSERT INTO public.scheduled_posts (company_id, page_id, content, scheduled_time, status, created_by, image_url)
  SELECT v_company_id, v_page_id, c.caption, c.ts, 'approved', v_created_by, c.image_url
    FROM (VALUES
      ($p$Monday has arrived before the salary 😅

The bills don't care about your pay date.

K500 into your mobile money in about 2 minutes - no paperwork, no bank queue.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-05 06:45:00+00', null::text),
      ($p$God bless the ones who repay on time 🙏

The rest of you... we are still praying for you 😅

New here? K500, repay K600 after 14 days.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-05 16:30:00+00', null::text),
      ($p$Ba auntie at the market: stock finished, customers waiting, no time for a bank queue.

She applied on her phone and opened her stall on time 😎

K500 today, repay K600 in 14 days.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-06 05:30:00+00', null::text),
      ($p$Which one are you? 👀

React 🤌 if you always repay on time.

React 😂 if the 14 days always disappear.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-06 11:00:00+00', null::text),
      ($p$We know you by your repayment history, not by your profile picture 😒

Some of you are very handsome with very bad records 😂

Come and fix it: K500, 14 days, applied on your phone.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-07 07:30:00+00', null::text),
      ($p$School fees don't wait for payday. Neither does the term opening 🏫

K500 sorted today, repay K600 after 14 days.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-07 15:15:00+00', null::text),
      ($p$Tag that friend who says "I will pay you on Friday" and never does 😂

We will help him with a proper 14-day plan.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-08 05:45:00+00', null::text),
      ($p$Payday is tomorrow. Rent is due today. We understand the feeling 😅

Apply now - K500 in your mobile money in minutes, repay K600 in 14 days.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-08 13:30:00+00', null::text),
      ($p$It's Friday. Your account balance has no plans 😂

Ours has K500 available for you.

Apply in 2 minutes 👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-09 07:00:00+00', null::text),
      ($p$Goodnight to everyone who paid on time 😴

To the ones who said "tomorrow"... God sees you 🙏😅

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-09 18:00:00+00', null::text),
      ($p$Real ZamCash: no deposit, no paperwork, no "agent fee". The money goes straight to your mobile money 🚨

If someone asks you to pay first, that is not us. Apply only through the official link.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-10 06:15:00+00', null::text),
      ($p$Someone applied while waiting at the bus stop and was approved before the bus arrived 😅

K500, no paperwork, no queue.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-10 14:30:00+00', null::text),
      ($p$Sunday is for church and rest. Monday is for plans 🙏

If your week needs a small push, we are open 24/7.

K500 in minutes, repay K600 after 14 days.

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-11 06:45:00+00', null::text),
      ($p$Another week done ✅ God is faithful 🙏

Tell us in the comments: what would you use K500 for? 👇

👉 https://zamcash.com/invite/812531$p$::text, timestamptz '2026-10-11 16:45:00+00', null::text)
    ) AS c(caption, ts, image_url)
   WHERE c.ts > now() + interval '15 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM public.scheduled_posts sp
        WHERE sp.company_id = v_company_id AND sp.content = c.caption
     );

  RAISE NOTICE 'ZamCash Loans: week posts scheduled (agent_takeover_enabled=true)';
END $$;
