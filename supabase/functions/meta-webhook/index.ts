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
    // Instagram events arrive with entry.id = IG user id; Facebook events with the page id.
    const platform = pageCred.ig_user_id && pageCred.ig_user_id === pageId ? "instagram" : "facebook";

    if (entry.changes) {
      for (const change of entry.changes) {
        // Facebook feed comments
        if (change.field === "feed") {
          const val = change.value;
          if (val.item !== "comment" || val.verb !== "add" || val.from?.id === pageId) continue;
          await persistCommentAndEnqueue(supabase, pageCred, {
            platform: "facebook",
            commentId: val.comment_id,
            postId: val.post_id,
            text: val.message,
            commenterName: val.from?.name,
            commenterId: val.from?.id,
            parentId: val.parent_id ?? null,
          });
        }
        // Instagram comments (object=instagram, field=comments)
        if (change.field === "comments") {
          const val = change.value;
          if (!val?.id || !val?.text || val.from?.id === pageId) continue;
          await persistCommentAndEnqueue(supabase, pageCred, {
            platform: "instagram",
            commentId: val.id,
            postId: val.media?.id ?? null,
            text: val.text,
            commenterName: val.from?.username,
            commenterId: val.from?.id,
            parentId: val.parent_id ?? null,
          });
        }
      }
    }

    // Messenger + Instagram DMs (both arrive as entry.messaging)
    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (!event.message?.text || event.message?.is_echo || event.sender?.id === pageId) continue;
        const senderId = event.sender.id;
        const text = event.message.text;
        const mid = event.message?.mid ?? null;

        // Conversation lifecycle (mirrors the WhatsApp pattern): one active
        // conversation per company + channel-scoped phone (fbdm:/igdm:) so
        // send-meta-dm can send autonomously and history/context works.
        const phone = (platform === "instagram" ? "igdm:" : "fbdm:") + senderId;
        const conversationId = await getOrCreateMetaConversation(supabase, pageCred.company_id, phone, platform);

        // Persist the inbound turn so reply context/history works.
        if (conversationId) {
          await supabase.from("messages").insert({ conversation_id: conversationId, role: "user", content: text });
        }

        await enqueueOrLegacy(supabase, {
          company_id: pageCred.company_id,
          channel: "direct_message",
          source: platform === "instagram" ? "meta_dm_ig" : "meta_dm_fb",
          external_id: mid,
          payload: {
            platform,
            page_id: pageCred.page_id,
            ig_user_id: platform === "instagram" ? pageId : null,
            sender_id: senderId,
            text,
            message_id: mid,
            conversation_id: conversationId,
          },
        });
      }
    }
  }
}

// Shared comment ingestion for Facebook feed + Instagram comment events.
async function persistCommentAndEnqueue(supabase: any, pageCred: any, c: {
  platform: string; commentId: string; postId: string | null; text: string;
  commenterName?: string; commenterId?: string; parentId: string | null;
}) {
  const { error: upsertErr } = await supabase.from("facebook_comments").upsert(
    {
      comment_id: c.commentId,
      post_id: c.postId,
      page_id: pageCred.page_id,
      company_id: pageCred.company_id,
      comment_text: c.text,
      commenter_name: c.commenterName,
      commenter_id: c.commenterId,
      parent_comment_id: c.parentId,
    },
    { onConflict: "comment_id" },
  );
  if (upsertErr) {
    console.error("[meta-webhook] facebook_comments upsert FAILED", { comment_id: c.commentId, error: upsertErr });
    return;
  }

  await enqueueOrLegacy(supabase, {
    company_id: pageCred.company_id,
    channel: "public_comment",
    source: c.platform === "instagram" ? "meta_comment_ig" : "meta_comment_fb",
    external_id: c.commentId,
    payload: {
      platform: c.platform,
      page_id: pageCred.page_id,
      comment_id: c.commentId,
      post_id: c.postId,
      parent_comment_id: c.parentId,
      text: c.text,
      commenter_name: c.commenterName,
      commenter_id: c.commenterId,
    },
  });
}

// One active conversation per company + channel-scoped phone (fbdm:/igdm:).
async function getOrCreateMetaConversation(supabase: any, companyId: string, phone: string, platform: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone", phone)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created } = await supabase
    .from("conversations")
    .insert({
      company_id: companyId,
      phone,
      status: "active",
      customer_name: (platform === "instagram" ? "IG " : "FB ") + phone.slice(-6),
      active_agent: "sales",
    })
    .select("id")
    .single();
  return created?.id || null;
}

async function getPageCredentials(supabase: any, pageId: string) {
  // Facebook events carry the page id; Instagram events carry the IG user id.
  const { data } = await supabase
    .from("meta_credentials")
    .select("*")
    .or(`page_id.eq.${pageId},ig_user_id.eq.${pageId}`)
    .limit(1)
    .maybeSingle();
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

    // OpenClaw removed. Event sits in inbound_events for the in-house Meta worker
    // (to be wired to MiniMax in a follow-up). No external dispatch.
    return;
  }

  // Legacy path disabled (openclaw-dispatch removed).
  console.warn("[meta-webhook] legacy dispatch path is disabled; enable USE_EVENT_QUEUE");
}

