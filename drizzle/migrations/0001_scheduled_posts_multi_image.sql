ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS image_urls text[];

COMMENT ON COLUMN public.scheduled_posts.image_urls IS
  'Ordered public image URLs for a multi-photo post. When 2 or more are present the publisher creates a native album post (Facebook) or carousel (Instagram). image_url mirrors image_urls[1] for backwards compatibility. Max 10.';

UPDATE public.scheduled_posts
   SET image_urls = ARRAY[image_url]
 WHERE image_url IS NOT NULL
   AND btrim(image_url) <> ''
   AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);

CREATE OR REPLACE FUNCTION public.sync_scheduled_post_image_url()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.image_urls IS NOT NULL AND array_length(NEW.image_urls, 1) >= 1 THEN
    NEW.image_url := NEW.image_urls[1];
  ELSIF (NEW.image_urls IS NULL OR array_length(NEW.image_urls, 1) IS NULL)
        AND NEW.image_url IS NOT NULL AND btrim(NEW.image_url) <> '' THEN
    NEW.image_urls := ARRAY[NEW.image_url];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_scheduled_post_image_url ON public.scheduled_posts;
CREATE TRIGGER trg_sync_scheduled_post_image_url
  BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_scheduled_post_image_url();