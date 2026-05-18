-- Normalized channel + source + status + error_class enums
do $$ begin
  create type public.event_channel as enum ('whatsapp', 'direct_message', 'public_comment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_source as enum (
    'twilio',
    'meta_whatsapp',
    'meta_dm_fb',
    'meta_dm_ig',
    'meta_comment_fb',
    'meta_comment_ig'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_status as enum ('pending','processing','sent','failed','dead','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_error_class as enum (
    'webhook_404','auth','tunnel_dead','timeout','empty_ai','send_failed','rate_limited','unknown'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid,
  channel public.event_channel not null,
  source public.event_source not null,
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  status public.event_status not null default 'pending',
  error_class public.event_error_class,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  ai_response text,
  model text,
  tokens int,
  latency_ms int,
  picked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inbound_events_dedupe
  on public.inbound_events(source, external_id)
  where external_id is not null;

create index if not exists inbound_events_queue_idx
  on public.inbound_events(status, next_attempt_at)
  where status in ('pending','processing');

create index if not exists inbound_events_company_idx
  on public.inbound_events(company_id, created_at desc);

create trigger inbound_events_set_updated_at
  before update on public.inbound_events
  for each row execute function public.update_updated_at_column();

alter table public.inbound_events enable row level security;

create policy "Company members can view their inbound events"
  on public.inbound_events for select
  using (public.user_has_company_access_v2(company_id));

-- Inserts/updates restricted to service role only (workers, webhooks).
-- No client-side write policies on purpose.