
ALTER TABLE public.swarm_runs
  ADD COLUMN IF NOT EXISTS profile text,
  ADD COLUMN IF NOT EXISTS bypass_reason text,
  ADD COLUMN IF NOT EXISTS bms_cache_hit boolean,
  ADD COLUMN IF NOT EXISTS divergence_score integer,
  ADD COLUMN IF NOT EXISTS mode text;
