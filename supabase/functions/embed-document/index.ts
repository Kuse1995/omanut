// embed-document: re-embeds a company_documents row and updates kb_sync_status.
// Invoked via pg_net trigger on INSERT/UPDATE of parsed_content. Fire-and-forget;
// the trigger does not wait for completion.
//
// Body: { document_id: string }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedText } from "../_shared/embedding-client.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let documentId: string | undefined;
  try {
    const body = await req.json();
    documentId = body?.document_id;
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!documentId) {
    return new Response(JSON.stringify({ error: "document_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await sb
    .from("company_documents")
    .update({ kb_sync_status: "syncing", kb_sync_error: null })
    .eq("id", documentId);

  const { data: doc, error: loadErr } = await sb
    .from("company_documents")
    .select("id, parsed_content")
    .eq("id", documentId)
    .maybeSingle();

  if (loadErr || !doc) {
    await sb
      .from("company_documents")
      .update({ kb_sync_status: "failed", kb_sync_error: loadErr?.message ?? "document not found" })
      .eq("id", documentId);
    return new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const text = (doc.parsed_content ?? "").toString().slice(0, 30_000);
  if (!text.trim()) {
    await sb
      .from("company_documents")
      .update({ kb_sync_status: "failed", kb_sync_error: "empty parsed_content" })
      .eq("id", documentId);
    return new Response(JSON.stringify({ ok: false, reason: "empty" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const vector = await embedText({ text, dimensions: 768, taskType: "RETRIEVAL_DOCUMENT" });
    await sb
      .from("company_documents")
      .update({
        embedding: vector as unknown as string,
        kb_sync_status: "synced",
        kb_sync_error: null,
        kb_synced_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("company_documents")
      .update({ kb_sync_status: "failed", kb_sync_error: msg })
      .eq("id", documentId);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
