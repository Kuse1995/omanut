import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SAFE_CLIENT_FALLBACK_REPLY =
  "Thanks for your message — I can help with products, pricing, orders, and support. What would you like to know?";

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
  if (!data) return false;
  return data.openclaw_mode === "primary" && data.openclaw_owns?.[channel] === true;
}

async function dispatchToOpenclaw(
  supabase: any,
  companyId: string,
  channel: string,
  eventType: string,
  payload: Record<string, unknown>,
  conversationId?: string,
): Promise<void> {
  try {
    await supabase.functions.invoke("openclaw-dispatch", {
      body: { company_id: companyId, channel, event_type: eventType, conversation_id: conversationId, payload },
    });
  } catch (e) {
    console.error("[meta-webhook][openclaw-dispatch] failed", e);
  }
}

function availabilityLabel(stockValue: unknown): string {
  const stock = Number(stockValue);
  if (!Number.isFinite(stock)) return "Availability: Check with us";
  if (stock <= 0) return "Availability: Out of stock";
  if (stock <= 5) return "Availability: Limited stock";
  return "Availability: In stock";
}

function looksLikeSensitiveLeak(reply: string): boolean {
  const text = reply.toLowerCase();
  const leakMarkers = [
    "===",
    "core instructions",
    "knowledge base",
    "document library",
    "page-specific instructions",
    "restricted topics",
    "system prompt",
    "banned topics",
    "higest priority",
    "highest priority",
    "company identity",
    "live product & pricing data",
  ];
  const markerHits = leakMarkers.reduce((count, marker) => count + (text.includes(marker) ? 1 : 0), 0);
  return markerHits >= 1;
}

function sanitizeClientReply(reply: string | null): string | null {
  const trimmed = reply?.trim();
  if (!trimmed) return null;
  if (looksLikeSensitiveLeak(trimmed)) {
    console.warn("[meta-webhook] Blocked potentially sensitive AI output");
    return SAFE_CLIENT_FALLBACK_REPLY;
  }
  return trimmed;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("META_VERIFY_TOKEN");
    if (mode === "subscribe" && token === verifyToken) {
      console.log("Verification successful");
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const backgroundTask = processWebhook(body);
      if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
        (globalThis as any).EdgeRuntime.waitUntil(backgroundTask);
      } else {
        backgroundTask.catch((err) => console.error("Background task error:", err));
      }
      return new Response(JSON.stringify({ status: "received" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error parsing webhook:", error);
      return new Response(JSON.stringify({ status: "error" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  return new Response("Method not allowed", { status: 405 });
});

async function processWebhook(body: any) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const objectType = body.object;

  if (!body.entry) return;

  if (objectType === "page") {
    for (const entry of body.entry) {
      const pageId = entry.id;
      const hasMessagingArray = Array.isArray(entry.messaging) && entry.messaging.length > 0;
      const pageCred = await getPageCredentials(supabase, pageId);
      const linkedIgUserId = pageCred?.ig_user_id;

      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "feed") {
            const value = change.value;
            if (!value || value.item !== "comment" || value.verb !== "add") continue;

            const commentId = value.comment_id;
            const messageText = value.message;
            const commenterName = value.from?.name || "User";
            const commenterFbId = value.from?.id;
            const postId = value.post_id || value.parent_id || null;
            const parentCommentText = value.parent?.message || null;

            if (!commentId || !messageText) continue;
            if (commenterFbId === pageId) continue;

            console.log(`Processing FB comment ${commentId}`);

            // === THE FIX: INGEST COMMENT TO DATABASE ===
            if (pageCred?.company_id) {
              const { error: insertError } = await supabase.from("facebook_comments").upsert(
                {
                  comment_id: commentId,
                  post_id: postId,
                  page_id: pageId,
                  company_id: pageCred.company_id,
                  comment_text: messageText,
                  commenter_name: commenterName,
                  commenter_id: commenterFbId,
                },
                { onConflict: "comment_id" },
              );
              if (insertError) console.error("[meta-webhook] Failed to save comment to DB:", insertError);
            }
            // ===========================================

            try {
              await handleComment(
                supabase,
                pageId,
                commentId,
                messageText,
                commenterName,
                commenterFbId,
                postId,
                parentCommentText,
              );
            } catch (err) {
              console.error(`Error handling comment ${commentId}:`, err);
            }
            continue;
          }

          if (!hasMessagingArray && change.field === "messages") {
            const value = change.value;
            const messageEvents = Array.isArray(value?.messaging)
              ? value.messaging
              : value?.sender && value?.recipient && value?.message
                ? [value]
                : [];
            for (const event of messageEvents) {
              if (!event.message?.text || event.message?.is_echo) continue;
              const senderId = event.sender?.id;
              const messageText = event.message.text;
              if (!senderId || !messageText || senderId === pageId) continue;
              const recipientId = event.recipient?.id;
              const isInstagramDM = !!linkedIgUserId && String(recipientId) === String(linkedIgUserId);
              const referral = normalizeMetaReferral(event.message?.referral || event.referral || null);

              try {
                if (isInstagramDM)
                  await handleInstagramDM(supabase, String(linkedIgUserId), senderId, messageText, referral);
                else await handleMessengerDM(supabase, pageId, senderId, messageText, referral);
              } catch (err) {
                console.error("Error handling message event:", err);
              }
            }
          }
        }
      }

      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (!event.message?.text || event.message?.is_echo) continue;
          const senderId = event.sender?.id;
          const messageText = event.message.text;
          if (!senderId || !messageText || senderId === pageId) continue;
          const recipientId = event.recipient?.id;
          const isInstagramDM = !!linkedIgUserId && String(recipientId) === String(linkedIgUserId);
          const referral = normalizeMetaReferral(event.message?.referral || event.referral || null);

          try {
            if (isInstagramDM) await handleInstagramDM(supabase, linkedIgUserId, senderId, messageText, referral);
            else await handleMessengerDM(supabase, pageId, senderId, messageText, referral);
          } catch (err) {
            console.error("Error handling messaging event:", err);
          }
        }
      }
    }
  } else if (objectType === "whatsapp_business_account") {
    // ... WABA logic left unchanged as it routes directly ...
  }
}

// ... All helper functions (getPageCredentials, handleComment, generateAIReply, etc.) remain identical below this point. I have truncated them for character limits, but YOU MUST paste your original bottom half back in below the `processWebhook` function block!
