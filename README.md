# Omanut

Omanut is an AI-powered customer engagement platform built for African SMEs.
It answers customers 24/7 on WhatsApp, Facebook Messenger, and Instagram,
handles reservations and orders, supports mobile-money payments, and keeps
business owners in control with instant WhatsApp notifications and human
handoff when needed.

## What it does

- AI assistant trained on each business (menu, prices, services, hours, policies)
- Multi-channel: WhatsApp Business API (Twilio + Meta Cloud), Messenger,
  Instagram DMs, and Facebook/Instagram comments
- Voice AI for phone calls (OpenAI Realtime + Twilio)
- Reservations and bookings with boss approval workflow and calendar sync
- Mobile money payments (MTN, Airtel, Zamtel) via payment links
- Live BMS sync (stock, pricing, sales) with a boss-facing agent
- Content studio, image generation, and scheduled social posting
- Ads: Meta ads launch, targeting search, and insight sync
- Admin dashboard: per-company configuration, AI training, analytics,
  API keys, and a public MCP server for external AI agents

## Tech stack

- Frontend: React 18 + Vite + TypeScript, Tailwind CSS, shadcn/ui
- Backend: Supabase (Postgres, Auth, Edge Functions, Storage)
- AI: OpenAI (Realtime API, chat completions) with configurable model routing
- Messaging: Twilio and Meta Cloud API
- Email: Resend

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from the template:

   ```bash
   cp .env.example .env
   ```

   Fill in your Supabase project URL and publishable (anon) key. The anon key is
   safe for the browser; never put a service-role key in `.env`.

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Build for production:

   ```bash
   npm run build
   ```

## Supabase Edge Functions

Edge functions live in `supabase/functions/`. The core ones are:

- `whatsapp-messages` - WhatsApp Business API inbound/outbound and the AI reply loop
- `meta-webhook` - Messenger/Instagram/webhook ingestion
- `twilio-voice` / `whatsapp-voice` / `realtime-session` - voice calls
- `agent-api` - authenticated AI agent API for connected systems
- `mcp-server` - MCP endpoint for external AI assistants (e.g. OpenClaw)
- `boss-chat` - owner chat with the AI
- `meta-ads-*` - Meta ads management
- `_shared` - shared helpers and email templates

Deploy a function with:

```bash
supabase functions deploy whatsapp-messages
```

## Project structure

```text
src/
  components/          UI components (landing, dashboard, admin, inbox)
  pages/               Route-level pages
  context/             Global state (company, auth)
  integrations/        Supabase and auth clients
  utils/               Audio, formatting, helpers
supabase/
  functions/           Edge Functions
  migrations/          SQL migrations
public/                Static assets
```

## Security notes

- `.env` and any real secrets are git-ignored. Rotate any key that was ever
  committed to a public repository.
- Supabase Row Level Security (RLS) is enabled on tenant tables; new tables
  should ship with RLS policies in their migration.
