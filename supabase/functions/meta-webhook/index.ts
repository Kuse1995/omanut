import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── OPENCLAW PRIMARY GUARD ──
async function openclawPrimaryFor(
  supabase: any,
  companyId: string,
  channel: "meta_dm" | "comments" | "whatsapp",
): Promise<boolean> {
  if (!companyId) return false;
  const { data } = await supabase
    .from("companies")
    .select("openclaw_mode, openclaw_owns")
    .eq("id", companyId)
    .maybeSingle();
  return data?.openclaw_mode === "primary" && data?.openclaw_owns?.[channel] === true;
}

async function dispatchToOpenclaw(
  supabase: any,
  companyId: string,
  channel: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.functions.invoke("openclaw-dispatch", {
      body: { company_id: companyId, channel, event_type: eventType, payload },
    });
  } catch (e) {
    console.error("[meta-webhook] dispatch failed", e);
  }
}

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
    } catch (e) {
      return new Response(JSON.stringify({ status: "error" }), { status: 200, headers: corsHeaders });
    }
  }
  return new Response("Method not allowed", { status: 405 });
});

async function processWebhook(body: any) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const objectType = body.object;
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

          // === THE FIX: PERSIST TO DB BEFORE DISPATCH ===
          await supabase.from("facebook_comments").upsert(
            {
              comment_id: val.comment_id,
              post_id: val.post_id,
              page_id: pageId,
              company_id: pageCred.company_id,
              comment_text: val.message,
              commenter_name: val.from?.name,
              commenter_id: val.from?.id,
            },
            { onConflict: "comment_id" },
          );

          await handleComment(supabase, pageId, val.comment_id, val.message, val.from?.name, val.from?.id, val.post_id);
        }
      }
    }

    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (!event.message?.text || event.message?.is_echo || event.sender?.id === pageId) continue;
        await handleMessengerDM(supabase, pageId, event.sender.id, event.message.text);
      }
    }
  }
}

// ── HELPER FUNCTIONS ──

async function getPageCredentials(supabase: any, pageId: string) {
  const { data } = await supabase.from("meta_credentials").select("*").eq("page_id", pageId).maybeSingle();
  return data;
}

async function handleComment(
  supabase: any,
  pageId: string,
  commentId: string,
  text: string,
  name: string,
  fbId: string,
  postId: string,
) {
  const cred = await getPageCredentials(supabase, pageId);
  if (await openclawPrimaryFor(supabase, cred.company_id, "comments")) {
    await dispatchToOpenclaw(supabase, cred.company_id, "comments", "inbound_comment", {
      platform: "facebook",
      comment_id: commentId,
      text,
      commenter_name: name,
      post_id: postId,
    });
  }
}

async function handleMessengerDM(supabase: any, pageId: string, senderId: string, text: string) {
  const cred = await getPageCredentials(supabase, pageId);
  if (await openclawPrimaryFor(supabase, cred.company_id, "meta_dm")) {
    await dispatchToOpenclaw(supabase, cred.company_id, "meta_dm", "inbound_dm", {
      platform: "messenger",
      sender_id: senderId,
      text,
    });
  }
}

// ... Additional helper functions for Instagram and Lead Alerts can be added as needed.
