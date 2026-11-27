-- Idempotent URL rewrite script for migrating DB data from dzheddvoiauevcayifev -> rwjeuiwaiflidurgqpks.
-- Safe to re-run multiple times after importing the Lovable Cloud SQL dump.

DO $$
DECLARE
  v_old text := 'https://dzheddvoiauevcayifev.supabase.co';
  v_new text := 'https://rwjeuiwaiflidurgqpks.supabase.co';
  v_has_col boolean;
BEGIN
  -- scheduled_posts.image_url & image_urls[]
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='scheduled_posts' AND column_name='image_url') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.scheduled_posts
       SET image_url = replace(image_url, v_old, v_new)
     WHERE image_url LIKE '%' || v_old || '%';
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='scheduled_posts' AND column_name='image_urls') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.scheduled_posts
       SET image_urls = ARRAY(SELECT replace(u, v_old, v_new) FROM unnest(image_urls) AS u)
     WHERE array_to_string(image_urls, ',') LIKE '%' || v_old || '%';
  END IF;

  -- generated_images
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generated_images' AND column_name='image_url') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.generated_images
       SET image_url = replace(image_url, v_old, v_new)
     WHERE image_url LIKE '%' || v_old || '%';
  END IF;

  -- video_generation_jobs
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_jobs' AND column_name='video_url') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.video_generation_jobs
       SET video_url = replace(video_url, v_old, v_new)
     WHERE video_url LIKE '%' || v_old || '%';
  END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_jobs' AND column_name='thumbnail_url') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.video_generation_jobs
       SET thumbnail_url = replace(thumbnail_url, v_old, v_new)
     WHERE thumbnail_url LIKE '%' || v_old || '%';
  END IF;

  -- brand_kits
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brand_kits' AND column_name='logo_url') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.brand_kits
       SET logo_url = replace(logo_url, v_old, v_new)
     WHERE logo_url LIKE '%' || v_old || '%';
  END IF;

  -- companies.metadata (jsonb)
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='metadata') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.companies
       SET metadata = replace(metadata::text, v_old, v_new)::jsonb
     WHERE metadata::text LIKE '%' || v_old || '%';
  END IF;

  -- image_generation_settings (any url columns / text config)
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='image_generation_settings' AND column_name='brand_reference_urls') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.image_generation_settings
       SET brand_reference_urls = ARRAY(SELECT replace(u, v_old, v_new) FROM unnest(brand_reference_urls) AS u)
     WHERE array_to_string(brand_reference_urls, ',') LIKE '%' || v_old || '%';
  END IF;

  -- marketer_messages.media_urls[]
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='marketer_messages' AND column_name='media_urls') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.marketer_messages
       SET media_urls = ARRAY(SELECT replace(u, v_old, v_new) FROM unnest(media_urls) AS u)
     WHERE array_to_string(media_urls, ',') LIKE '%' || v_old || '%';
  END IF;

  -- a2ui_sessions.ui_spec & result_payload
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='a2ui_sessions' AND column_name='ui_spec') INTO v_has_col;
  IF v_has_col THEN
    UPDATE public.a2ui_sessions
       SET ui_spec = replace(ui_spec::text, v_old, v_new)::jsonb
     WHERE ui_spec::text LIKE '%' || v_old || '%';
  END IF;
END $$;

-- Refresh DB trigger functions so they call the new project ref after any dump import.
CREATE OR REPLACE FUNCTION public.trigger_embed_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  IF NEW.parsed_content IS NULL OR length(trim(NEW.parsed_content)) = 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.parsed_content IS NOT DISTINCT FROM NEW.parsed_content THEN
    RETURN NEW;
  END IF;

  v_url := 'https://rwjeuiwaiflidurgqpks.supabase.co/functions/v1/embed-document';
  NEW.kb_sync_status := 'pending';
  NEW.kb_sync_error  := NULL;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body    := jsonb_build_object('document_id', NEW.id),
    timeout_milliseconds := 1500
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_check_rule_adherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'assistant' THEN RETURN NEW; END IF;
  IF NEW.content IS NULL OR length(trim(NEW.content)) < 3 THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := 'https://rwjeuiwaiflidurgqpks.supabase.co/functions/v1/check-rule-adherence',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('message_id', NEW.id),
    timeout_milliseconds := 1500
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
