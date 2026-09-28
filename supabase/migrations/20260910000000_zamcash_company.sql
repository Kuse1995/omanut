-- ZamCash Loans — company profile, AI configuration and knowledge base.
-- Affiliate setup: the AI answers on the ZamCash Facebook page and routes
-- customers to the owner's referral link (default 812531).
--
-- Step 1 of 2. Run this FIRST, then connect the ZamCash Facebook page to the
-- new company in the console, then run 20260910000100_zamcash_posts.sql.

DO $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT id INTO v_company_id FROM public.companies WHERE name = 'ZamCash Loans' LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (
      name, business_type, voice_style, hours, menu_or_offerings, branches,
      service_locations, currency_prefix, quick_reference_info, metadata, credit_balance
    ) VALUES (
      'ZamCash Loans',
      'Short-Term Digital Loans',
      $voice$Friendly, simple and professional Zambian customer service agent. Use clear and easy English. Be polite, helpful and direct. Do not use difficult words. Sound like a real person helping a customer.$voice$,
      'Online 24/7',
      $svc$Short-term digital loans through ZamCash. Customers apply online using their mobile phone. The current offer on the referral page is K500 with K600 repayment after 14 days. The loan is transferred to the customer's mobile money account. The application is mobile and does not require paperwork.$svc$,
      'Online - Zambia',
      'Online, Zambia',
      'K',
      $kb$ZamCash is a digital short-term loan service available online in Zambia.

Customers can apply for loans using their mobile phones.

The current referral page displays:
- Loan amount: K500
- Repayment amount: K600
- Repayment period: 14 days
- No paperwork
- 100% mobile application
- Loan can be transferred to the customer's mobile money account
- Supported mobile networks shown on the application include Airtel, MTN and Zamtel.

Customers need to enter their mobile number and follow the verification process.

The customer should always read the loan terms and repayment information shown during the application before accepting a loan.

Referral link 1 (default): https://zamcash.com/invite/812531
Referral link 2: https://zamcash.com/invite/730214

If a customer asks to apply for a loan, direct them to the appropriate ZamCash referral link provided for this company. Use link 1 (812531) unless the customer asks for the other one.

Never ask a customer to send money to an individual or agent in order to receive a ZamCash loan. ZamCash warns customers about people pretending to be ZamCash representatives and asking for deposits.

If a customer has questions about eligibility, approval, fees, repayment or an application that the AI cannot answer from the available information, direct them to ZamCash customer support rather than making up an answer.$kb$,
      '{"harness_mode":"off"}'::jsonb,
      1000
    ) RETURNING id INTO v_company_id;
  END IF;

  -- Optional legacy/services column when present
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='services') THEN
    EXECUTE format('UPDATE public.companies SET services = %L WHERE id = %L', $svc$Short-term digital loans through ZamCash. Customers apply online using their mobile phone. The current offer on the referral page is K500 with K600 repayment after 14 days. The loan is transferred to the customer's mobile money account. The application is mobile and does not require paperwork.$svc$, v_company_id);
  END IF;

  -- AI configuration
  IF NOT EXISTS (SELECT 1 FROM public.ai_config WHERE company_id = v_company_id) THEN
    INSERT INTO public.ai_config (
      company_id, system_instructions, qa_style, banned_topics,
      primary_model, response_length, fallback_message, tone_voice_guide
    ) VALUES (
      v_company_id,
      $inst$You are a friendly ZamCash loan assistant serving customers in Zambia.

Your job is to help customers understand the ZamCash short-term loan service and guide them to the correct application link.

Use very simple English that is easy for anyone in Zambia to understand.

Be friendly, short and helpful.

When someone says they need a loan, wants to apply, or asks how to get a loan, give them the appropriate ZamCash referral link.

Referral link 1 (DEFAULT): https://zamcash.com/invite/812531
Referral link 2: https://zamcash.com/invite/730214

If the customer has not specified which referral link they want, use the default referral link ending in 812531.

Do not claim that a customer is guaranteed to receive a loan. Loan approval is determined by ZamCash.

Do not make up loan amounts, fees, interest rates, repayment dates or eligibility requirements.

The current application page displays K500 cash with K600 repayment in 14 days. If the customer asks about other loan amounts, tell them that the amount available to them depends on what ZamCash shows in their application.

Explain that the application is done online using a mobile phone and the money is transferred to mobile money if the loan is approved.

Supported mobile networks shown on the application include Airtel, MTN and Zamtel.

Never tell customers to send money to an agent before receiving a loan.

Never ask customers to send their PIN, password, OTP or other private security information to you.

Never pretend to be an employee of ZamCash.

If you do not know the answer, tell the customer to contact ZamCash customer support or check the official ZamCash website.

Always encourage customers to read the repayment amount and loan terms before accepting a loan.

Keep responses short and easy to read.$inst$,
      $style$Short, friendly and simple. Use easy English suitable for a Zambian audience. Give direct answers. Use emojis sparingly when appropriate. When a customer wants to apply, clearly provide the application link. Avoid long explanations unless the customer asks for more information.$style$,
      $avoid$Do not give financial advice beyond explaining the ZamCash service. Do not guarantee loan approval. Do not invent loan amounts, interest rates, fees or repayment terms. Do not ask for PINs, passwords, OTPs or other confidential information. Do not ask customers to send money to an agent as a condition for receiving a loan. Do not make claims about guaranteed approval or guaranteed cash. Do not discuss politics, religion, medical advice or unrelated topics.$avoid$,
      'deepseek-chat',
      'short',
      'Let me check with the ZamCash team and come back to you shortly.',
      $voice$Friendly, simple and professional Zambian customer service agent. Use clear and easy English. Be polite, helpful and direct. Do not use difficult words. Sound like a real person helping a customer.$voice$
    );
  END IF;



  -- Knowledge base document
  IF NOT EXISTS (SELECT 1 FROM public.company_documents WHERE company_id = v_company_id AND filename = 'zamcash-knowledge.md') THEN
    INSERT INTO public.company_documents (company_id, filename, file_path, file_type, file_size, parsed_content)
    VALUES (v_company_id, 'zamcash-knowledge.md', 'kb/zamcash-knowledge.md', 'text/plain', 1363, $kb$ZamCash is a digital short-term loan service available online in Zambia.

Customers can apply for loans using their mobile phones.

The current referral page displays:
- Loan amount: K500
- Repayment amount: K600
- Repayment period: 14 days
- No paperwork
- 100% mobile application
- Loan can be transferred to the customer's mobile money account
- Supported mobile networks shown on the application include Airtel, MTN and Zamtel.

Customers need to enter their mobile number and follow the verification process.

The customer should always read the loan terms and repayment information shown during the application before accepting a loan.

Referral link 1 (default): https://zamcash.com/invite/812531
Referral link 2: https://zamcash.com/invite/730214

If a customer asks to apply for a loan, direct them to the appropriate ZamCash referral link provided for this company. Use link 1 (812531) unless the customer asks for the other one.

Never ask a customer to send money to an individual or agent in order to receive a ZamCash loan. ZamCash warns customers about people pretending to be ZamCash representatives and asking for deposits.

If a customer has questions about eligibility, approval, fees, repayment or an application that the AI cannot answer from the available information, direct them to ZamCash customer support rather than making up an answer.$kb$);
  END IF;



  RAISE NOTICE 'ZamCash Loans ready: % (next: connect the Facebook page, then run the posts migration)', v_company_id;
END $$;
