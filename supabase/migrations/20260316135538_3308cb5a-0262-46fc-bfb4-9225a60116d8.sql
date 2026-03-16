
-- 1. Add embedding column to company_media
ALTER TABLE public.company_media ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 2. Add embedding column to company_documents
ALTER TABLE public.company_documents ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 3. Add summary_embedding column to conversations
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS summary_embedding vector(768);

-- 4. Match media RPC
CREATE OR REPLACE FUNCTION public.match_media(
  query_embedding vector,
  match_company_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, description text, category text, file_path text, media_type text, tags text[], similarity double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.id, m.description, m.category::text, m.file_path, m.media_type,
    m.tags, 1 - (m.embedding <=> query_embedding) AS similarity
  FROM public.company_media m
  WHERE m.company_id = match_company_id
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 5. Match documents RPC
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_company_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 3
)
RETURNS TABLE(id uuid, filename text, parsed_content text, similarity double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.id, d.filename, d.parsed_content,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.company_documents d
  WHERE d.company_id = match_company_id
    AND d.embedding IS NOT NULL
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 6. Match conversations RPC
CREATE OR REPLACE FUNCTION public.match_conversations(
  query_embedding vector,
  match_company_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, phone text, customer_name text, transcript text, started_at timestamptz, similarity double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.phone, c.customer_name, c.transcript, c.started_at,
    1 - (c.summary_embedding <=> query_embedding) AS similarity
  FROM public.conversations c
  WHERE c.company_id = match_company_id
    AND c.summary_embedding IS NOT NULL
    AND 1 - (c.summary_embedding <=> query_embedding) > match_threshold
  ORDER BY c.summary_embedding <=> query_embedding
  LIMIT match_count;
$$;
