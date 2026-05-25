
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_embed_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  -- Only re-embed if there's content to embed
  IF NEW.parsed_content IS NULL OR length(trim(NEW.parsed_content)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Skip if nothing relevant changed on UPDATE
  IF TG_OP = 'UPDATE' AND OLD.parsed_content IS NOT DISTINCT FROM NEW.parsed_content THEN
    RETURN NEW;
  END IF;

  v_url := 'https://dzheddvoiauevcayifev.supabase.co/functions/v1/embed-document';

  -- Mark pending; the edge fn will flip to syncing -> synced/failed
  NEW.kb_sync_status := 'pending';
  NEW.kb_sync_error  := NULL;

  -- Fire-and-forget. Errors here must NOT block the user write.
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
  -- Never block the user write
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_embed_document ON public.company_documents;
CREATE TRIGGER trg_embed_document
  BEFORE INSERT OR UPDATE OF parsed_content ON public.company_documents
  FOR EACH ROW EXECUTE FUNCTION public.trigger_embed_document();
