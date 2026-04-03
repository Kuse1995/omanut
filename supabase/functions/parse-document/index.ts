import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import { embedText } from '../_shared/embedding-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Get document metadata
    const { data: document, error: docError } = await supabase
      .from('company_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Download the file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('company-documents')
      .download(document.file_path);

    if (downloadError || !fileData) {
      throw new Error('Failed to download file');
    }

    // Parse based on file type
    let parsedContent = '';
    
    if (document.file_type.includes('text') || document.file_type.includes('csv')) {
      parsedContent = await fileData.text();
    } else if (document.file_type.includes('pdf')) {
      parsedContent = `[PDF Document: ${document.filename}]\nPDF parsing requires additional processing. Content will be available soon.`;
    } else if (document.file_type.includes('word') || document.file_type.includes('document')) {
      parsedContent = `[Word Document: ${document.filename}]\nDocument parsing requires additional processing. Content will be available soon.`;
    } else if (document.file_type.includes('spreadsheet') || document.file_type.includes('excel')) {
      parsedContent = `[Spreadsheet: ${document.filename}]\nSpreadsheet parsing requires additional processing. Content will be available soon.`;
    }

    // Generate semantic embedding for the parsed content
    let embeddingVector: string | null = null;
    if (parsedContent && parsedContent.length > 10) {
      try {
        // Truncate to first ~2000 chars for embedding (avoid overly long texts)
        const textToEmbed = `${document.filename}: ${parsedContent.substring(0, 2000)}`;
        const embedding = await embedText({
          text: textToEmbed,
          dimensions: 768,
          taskType: 'RETRIEVAL_DOCUMENT',
        });
        embeddingVector = `[${embedding.join(',')}]`;
        console.log(`[PARSE-DOC] ✓ Embedding generated for "${document.filename}"`);
      } catch (embErr) {
        console.error('[PARSE-DOC] Embedding failed (non-fatal):', embErr);
      }
    }

    // Update document with parsed content and embedding
    const updatePayload: any = { parsed_content: parsedContent };
    if (embeddingVector) {
      updatePayload.embedding = embeddingVector;
    }

    const { error: updateError } = await supabase
      .from('company_documents')
      .update(updatePayload)
      .eq('id', documentId);

    if (updateError) {
      throw updateError;
    }

    console.log('Document parsed successfully');
    return new Response(
      JSON.stringify({ success: true, parsedContent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error parsing document:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
