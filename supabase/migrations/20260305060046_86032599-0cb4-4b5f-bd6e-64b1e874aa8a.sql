ALTER TABLE public.scheduled_posts ADD COLUMN target_platform text NOT NULL DEFAULT 'facebook';
ALTER TABLE public.meta_credentials ADD COLUMN ig_user_id text;