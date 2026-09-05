// parse-document — real text extraction for the Company Brain.
// PDF (pdf.js/unpdf), DOCX (zip+XML), XLSX (SheetJS), CSV/TXT.
// Stores the extracted text on company_documents.parsed_content (scanned by
// searchKnowledgeBase across every channel) + an embedding for semantic use.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import { embedText } from '../_shared/embedding-client.ts';
import { extractDocumentText } from '../_shared/document-extract.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_PARSED_CHARS = 60000;
const EMBED_CHARS = 8000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { documentId } = await req.json();
    console.log('Parsing document:', documentId);

    const { data: document, error: docError } = await supabase
      .from('company_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('company-documents')
      .download(document.file_path);

    if (downloadError || !fileData) {
      throw new Error('Failed to download file');
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    console.log('Downloaded', bytes.length, 'bytes —', document.filename);

    let parsedContent = '';
    let format = 'unknown';
    try {
      const out = await extractDocumentText(bytes, String(document.filename || ''), String(document.file_type || ''));
      if (out) {
        parsedContent = out.text;
        format = out.format;
      }
    } catch (e) {
      console.error('Extraction failed for', document.filename, e);
    }

    if (!parsedContent || parsedContent.trim().length < 20) {
      parsedContent = '[' + document.filename + '] Text could not be extracted automatically. Text-based PDFs, DOCX, XLSX, CSV and TXT are fully supported — scanned/image-only PDFs need OCR. Re-upload in one of those formats and I will read every word.';
      format = 'unparsed';
    }

    parsedContent = parsedContent.slice(0, MAX_PARSED_CHARS);
    console.log('Extracted', parsedContent.length, 'chars as', format);

    // Semantic embedding over the leading content (keyword search reads the
    // full text; the embedding adds semantic matching on the head).
    let embeddingVector: string | null = null;
    const textToEmbed = document.filename + ': ' + parsedContent.slice(0, EMBED_CHARS);
    if (textToEmbed.length > 20) {
      try {
        const embedding = await embedText({
          text: textToEmbed,
          dimensions: 768,
          taskType: 'RETRIEVAL_DOCUMENT',
        });
        embeddingVector = '[' + embedding.join(',') + ']';
        console.log('[PARSE-DOC] embedding generated for "' + document.filename + '"');
      } catch (embErr) {
        console.error('[PARSE-DOC] Embedding failed (non-fatal):', embErr);
      }
    }

    const updatePayload: any = { parsed_content: parsedContent };
    if (embeddingVector) updatePayload.embedding = embeddingVector;

    const { error: updateError } = await supabase
      .from('company_documents')
      .update(updatePayload)
      .eq('id', documentId);

    if (updateError) throw updateError;

    console.log('Document parsed successfully');
    return new Response(
      JSON.stringify({ success: true, format, chars: parsedContent.length, parsedContent: parsedContent.slice(0, 500) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error parsing document:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
