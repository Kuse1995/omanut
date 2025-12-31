-- Fix the search_path for the new function
ALTER FUNCTION public.update_generated_images_updated_at() SET search_path = public;