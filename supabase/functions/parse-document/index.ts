import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

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
      // Plain text or CSV
      parsedContent = await fileData.text();
    } else if (document.file_type.includes('pdf')) {
      // For PDFs, we'd need a PDF parsing library
      // For now, store a placeholder
      parsedContent = `[PDF Document: ${document.filename}]\nPDF parsing requires additional processing. Content will be available soon.`;
    } else if (document.file_type.includes('word') || document.file_type.includes('document')) {
      // For Word docs, we'd need a DOCX parsing library
      parsedContent = `[Word Document: ${document.filename}]\nDocument parsing requires additional processing. Content will be available soon.`;
    } else if (document.file_type.includes('spreadsheet') || document.file_type.includes('excel')) {
      // For Excel files
      parsedContent = `[Spreadsheet: ${document.filename}]\nSpreadsheet parsing requires additional processing. Content will be available soon.`;
    }

    // Update document with parsed content
    const { error: updateError } = await supabase
      .from('company_documents')
      .update({ parsed_content: parsedContent })
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
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});