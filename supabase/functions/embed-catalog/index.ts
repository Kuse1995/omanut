import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
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
    const { company_id, product_id } = await req.json();
    if (!company_id) throw new Error('company_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Build query — single product or all products for company
    let query = supabase
      .from('payment_products')
      .select('id, name, description, category, price, currency')
      .eq('company_id', company_id)
      .eq('is_active', true);

    if (product_id) {
      query = query.eq('id', product_id);
    }

    const { data: products, error } = await query;
    if (error) throw new Error(`DB error: ${error.message}`);
    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ success: true, indexed: 0, message: 'No products to index' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[EMBED-CATALOG] Indexing ${products.length} products for company ${company_id}`);

    let indexed = 0;
    let failed = 0;

    for (const product of products) {
      try {
        // Combine name + description + category for rich embedding
        const textToEmbed = [
          product.name,
          product.description || '',
          product.category || '',
          product.price ? `${product.currency || 'K'}${product.price}` : '',
        ].filter(Boolean).join(' — ');

        const embedding = await embedText({
          text: textToEmbed,
          dimensions: 768,
          taskType: 'RETRIEVAL_DOCUMENT',
        });

        // Store embedding as vector string format for pgvector
        const vectorStr = `[${embedding.join(',')}]`;

        const { error: updateError } = await supabase
          .from('payment_products')
          .update({ embedding: vectorStr })
          .eq('id', product.id);

        if (updateError) {
          console.error(`[EMBED-CATALOG] Update failed for ${product.id}:`, updateError.message);
          failed++;
        } else {
          indexed++;
          console.log(`[EMBED-CATALOG] ✓ ${product.name}`);
        }

        // Small delay to avoid rate limiting
        if (products.length > 5) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) {
        console.error(`[EMBED-CATALOG] Failed to embed "${product.name}":`, e);
        failed++;
      }
    }

    console.log(`[EMBED-CATALOG] Done: ${indexed} indexed, ${failed} failed`);

    return new Response(JSON.stringify({
      success: true,
      indexed,
      failed,
      total: products.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[EMBED-CATALOG] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
