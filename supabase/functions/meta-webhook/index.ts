import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USE_EVENT_QUEUE = (Deno.env.get("USE_EVENT_QUEUE") ?? "true").toLowerCase() !== "false";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (token === Deno.env.get("META_VERIFY_TOKEN")) return new Response(challenge, { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const backgroundTask = processWebhook(body);
      if (typeof (globalThis as any).EdgeRuntime !== "undefined")
        (globalThis as any).EdgeRuntime.waitUntil(backgroundTask);
      return new Response(JSON.stringify({ status: "received" }), { status: 200, headers: corsHeaders });
    } catch (_e) {
      return new Response(JSON.stringify({ status: "error" }), { status: 200, headers: corsHeaders });
    }
  }
  return new Response("Method not allowed", { status: 405 });
});

async function processWebhook(body: any) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!body.entry) return;

  for (const entry of body.entry) {
    const pageId = entry.id;
    const pageCred = await getPageCredentials(supabase, pageId);
    if (!pageCred) continue;

    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === "feed") {
          const val = change.value;
          if (val.item !== "comment" || val.verb !== "add" || val.from?.id === pageId) continue;

          // Persist comment row (used by send-facebook-comment-reply Mode 2 + UI).
          const { error: upsertErr } = await supabase.from("facebook_comments").upsert(
            {
              comment_id: val.comment_id,
              post_id: val.post_id,
              page_id: pageId,
              company_id: pageCred.company_id,
              comment_text: val.message,
              commenter_name: val.from?.name,
              commenter_id: val.from?.id,
              parent_comment_id: val.parent_id ?? null,
            },
            { onConflict: "comment_id" },
          );
          if (upsertErr) {
            console.error("[meta-webhook] facebook_comments upsert FAILED", { comment_id: val.comment_id, error: upsertErr });
            continue;
          }

          await enqueueOrLegacy(supabase, {
            company_id: pageCred.company_id,
            channel: "public_comment",
            source: "meta_comment_fb",
            external_id: val.comment_id,
            payload: {
              platform: "facebook",
              page_id: pageId,
              comment_id: val.comment_id,
              post_id: val.post_id,
              parent_comment_id: val.parent_id ?? null,
              text: val.message,
              commenter_name: val.from?.name,
              commenter_id: val.from?.id,
            },
          });
        }
      }
    }

    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (!event.message?.text || event.message?.is_echo || event.sender?.id === pageId) continue;

        await enqueueOrLegacy(supabase, {
          company_id: pageCred.company_id,
          channel: "direct_message",
          source: "meta_dm_fb",
          external_id: event.message?.mid ?? null,
          payload: {
            platform: "messenger",
            page_id: pageId,
            sender_id: event.sender.id,
            text: event.message.text,
            message_id: event.message?.mid ?? null,
          },
        });
      }
    }
  }
}

async function getPageCredentials(supabase: any, pageId: string) {
  const { data } = await supabase.from("meta_credentials").select("*").eq("page_id", pageId).maybeSingle();
  return data;
}

interface EnqueueInput {
  company_id: string;
  channel: "direct_message" | "public_comment" | "whatsapp";
  source: string;
  external_id?: string | null;
  payload: Record<string, unknown>;
}

async function enqueueOrLegacy(supabase: any, e: EnqueueInput) {
  if (USE_EVENT_QUEUE) {
    // Insert (idempotent on (source, external_id) when external_id is set)
    const { data: row, error } = await supabase
      .from("inbound_events")
      .insert({
        company_id: e.company_id,
        channel: e.channel,
        source: e.source,
        external_id: e.external_id ?? null,
        payload: e.payload,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      // Dedupe collision — already enqueued, nothing to do.
      if ((error as any).code === "23505") {
        console.log("[meta-webhook] duplicate event ignored", e.source, e.external_id);
        return;
      }
      console.error("[meta-webhook] enqueue failed", error);
      return;
    }

    // Kick the worker immediately — don't wait for cron.
    try {
      await supabase.functions.invoke("openclaw-worker", { body: { event_id: row.id } });
    } catch (err) {
      console.warn("[meta-webhook] worker invoke failed (cron will retry)", String(err).slice(0, 200));
    }
    return;
  }

  // Legacy path (USE_EVENT_QUEUE=false rollback) — fall back to old openclaw-dispatch behaviour.
  try {
    await supabase.functions.invoke("openclaw-dispatch", {
      body: {
        company_id: e.company_id,
        channel: e.channel === "public_comment" ? "comments" : "meta_dm",
        event_type: e.channel === "public_comment" ? "inbound_comment" : "inbound_dm",
        payload: e.payload,
      },
    });
  } catch (err) {
    console.error("[meta-webhook] legacy dispatch failed", err);
  }
}
