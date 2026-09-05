-- Point the farm harness's business config at the REAL business.
-- The harness (omanut-harness) reads agent_config for its persona; it was
-- still carrying the old demo-lodge/kitchen defaults, which leaked into
-- harness-written content ("straight from our kitchen"). One row, real context.

DELETE FROM public.agent_config;

INSERT INTO public.agent_config (
  restaurant_name,
  restaurant_hours,
  menu,
  instructions,
  currency_prefix,
  branches,
  seating_areas
) VALUES (
  'Omanut Technologies Ltd',
  'Mon-Sat: 08:00 - 18:00 (WhatsApp agent 24/7)',
  'Omanut BMS — business management software for African SMEs: sales & invoicing, inventory, POS, payroll, financial reporting, WhatsApp assistant. Starter K299/month, Pro from K499/month. Social Media Marketing Packages: Starter K2,500/month (8 posts, 1 platform), Growth K3,800/month (12 posts/reels/stories, 2 platforms, 1 targeted ad campaign), Premium K8,500/month (20+ posts, 3 platforms, 3 ad campaigns). Free Business Training every Saturday 10:00 via Google Meet. JurisAI legal-tech for statutory research and compliance.',
  'You are Omanut Technologies'' AI agent. Warm, professional, solution-oriented. This is a SOFTWARE company — never reference a kitchen, restaurant, food, lodge, rooms or bookings. Quote only the prices listed above; never invent prices or claims. Tagline: ''we''''ll figure it out!''. CTA: DM us or WhatsApp to get started.',
  'K',
  'Lusaka (HQ), Copperbelt',
  'Online (Google Meet), On-site visits'
);
