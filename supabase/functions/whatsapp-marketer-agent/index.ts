import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../_shared/gemini-client.ts';
import { buildBrandBlock } from '../_shared/marketing.ts';
import { createSignedA2UISession, A2UISurfaceType } from '../_shared/a2ui-token.ts';
import {
  downloadTwilioMedia,
  normalizeDigits,
  sendMarketerWhatsApp,
} from '../_shared/marketer-twilio.ts';
import {
  checkMarketerQuota,
  incrementMarketerUsage,
  MarketerSubscriptionRow,
  resolveEffectiveUserId,
} from '../_shared/marketer-billing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InboundMedia {
  url: string;
  contentType: string;
}

interface CompanyRow {
  id: string;
  name: string;
  business_type: string | null;
  services: string | null;
  hours: string | null;
  quick_reference_info: string | null;
  metadata: Record<string, unknown> | null;
}

interface SubWithCompany extends MarketerSubscriptionRow {
  companies: CompanyRow | null;
}

const VALID_MEDIA_CATEGORIES = new Set([
  'menu', 'interior', 'exterior', 'logo', 'products', 'promotional', 'staff', 'events', 'facilities', 'other',
]);

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function lusakaNowDisplay(): { isoLocal: string; dateStr: string; dayName: string; hour: number } {
  const offsetMs = 2 * 60 * 60 * 1000;
  const local = new Date(Date.now() + offsetMs);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const isoLocal = local.toISOString().replace('Z', '+02:00');
  return {
    isoLocal,
    dateStr: isoLocal.slice(0, 10),
    dayName: days[local.getUTCDay()],
    hour: local.getUTCHours(),
  };
}

/** Convert "YYYY-MM-DD HH:mm" or ISO string (defaulting naive strings to Africa/Lusaka +02:00) into UTC ISO. */
function parseLusakaTimeToUtcIso(input?: string | null): string {
  if (!input || !input.trim()) {
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }
  const s = input.trim();
  if (/(Z|[+-]\d{2}:\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const withSec = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
  const parsed = Date.parse(`${withSec}+02:00`);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function extFromMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('quicktime') || lower.includes('mov')) return 'mov';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('m4a') || lower.includes('mp4a')) return 'm4a';
  return lower.startsWith('video/') ? 'mp4' : 'jpg';
}

async function transcribeAudioViaGemini(bytes: Uint8Array, mimeType: string): Promise<string | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;
  const cleanMime = mimeType.split(';')[0].trim() || 'audio/ogg';
  const base64 = encodeBase64(bytes);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'Transcribe this WhatsApp voice note accurately in English (preserve brand/product names, Lusaka locations, and Kwacha prices accurately). Return ONLY the spoken transcript, no preamble.' },
              { inlineData: { mimeType: cleanMime, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    }
  );
  if (!res.ok) {
    console.warn('[marketer-agent] Audio transcription failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json().catch(() => ({}));
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

async function analyzeInspirationImage(bytes: Uint8Array, mimeType: string, note: string): Promise<string | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;
  const cleanMime = mimeType.split(';')[0].trim() || 'image/jpeg';
  const base64 = encodeBase64(bytes);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `A business owner forwarded this competitor/inspiration social media post saying: "${note || 'Make something similar'}". Extract concisely: 1) Visual layout & composition style, 2) Messaging hook structure & CTA style, 3) Why it works. Do NOT copy competitor brand names — extract the creative formula so we can recreate an original version for the user's brand.`,
              },
              { inlineData: { mimeType: cleanMime, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
      }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function runPitchDemoTurn(opts: {
  supabase: SupabaseClient;
  supabaseUrl: string;
  phone: string;
  toNumber: string;
  body: string;
  mediaFiles: InboundMedia[];
}) {
  const { supabase, phone, toNumber, body, mediaFiles } = opts;
  const { data: session } = await supabase
    .from('marketer_sessions')
    .select('pending_draft')
    .eq('phone', phone)
    .maybeSingle();

  const today = lusakaNowDisplay().dateStr;
  const draftState = (session?.pending_draft || {}) as Record<string, unknown>;
  const prevDate = typeof draftState.demo_date === 'string' ? draftState.demo_date : '';
  const prevCount = prevDate === today ? Number(draftState.demo_count || 0) : 0;

  if (prevCount >= 5) {
    await sendMarketerWhatsApp({
      to: phone,
      fromOverride: toNumber,
      body: `You've tried 5 quick pitch previews today! Message your Omanut representative to activate a full account with your own Content Vault, Brand DNA, AI graphics & Reels, and automated posting.`,
    });
    return;
  }

  let visualContext = '';
  if (mediaFiles.length > 0 && mediaFiles[0].contentType.startsWith('image/')) {
    try {
      const { bytes, contentType } = await downloadTwilioMedia(mediaFiles[0].url);
      const apiKey = Deno.env.get('GEMINI_API_KEY');
      if (apiKey) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: 'Describe the product/service visible in this photo in 2 crisp sentences so a social media marketer can write compelling Instagram/Facebook captions for it.' },
                  { inlineData: { mimeType: contentType.split(';')[0], data: encodeBase64(bytes) } },
                ],
              }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
            }),
          }
        );
        const json = await res.json().catch(() => ({}));
        visualContext = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    } catch (e) {
      console.warn('[marketer-agent] pitch demo photo inspect failed:', e);
    }
  }

  const aiRes = await geminiChatWithFallback({
    model: PRIMARY_TEXT_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are Omanut's AI Social Media Marketer giving a live 30-second WhatsApp pitch demo to a prospective business owner in Zambia. Write a tight, impressive response showing:
1) 1 crisp content strategy angle tailored to their business
2) 2 scroll-stopping Facebook/Instagram captions with emojis + CTA
3) Briefly mention what unlocks once activated: their personal Content Vault, 1-tap weekly calendar grid, brand-locked AI graphics & Reels, and automatic posting — all from this single WhatsApp chat. Keep under 1,000 characters.`,
      },
      {
        role: 'user',
        content: `Prospect brief: ${body}\n${visualContext ? `Photo they sent shows: ${visualContext}` : ''}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 700,
  });

  let replyText =
    `✨ *Omanut AI Social Marketer Preview*\n\nSend "DEMO Your Business Name" plus a photo of your product or shop and I'll craft a live campaign preview for you right here!`;
  if (aiRes.ok) {
    const parsed = await aiRes.json().catch(() => ({}));
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) replyText = content.trim();
  }

  await supabase.from('marketer_sessions').upsert({
    phone,
    mode: 'pitch_demo',
    pending_draft: { demo_date: today, demo_count: prevCount + 1 },
    last_message_at: new Date().toISOString(),
  });

  await sendMarketerWhatsApp({ to: phone, fromOverride: toNumber, body: replyText });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (bearer !== serviceKey) {
    return jsonRes({ error: 'Unauthorized — internal function' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const reqBody = await req.json().catch(() => ({}));
    const isInternalEvent = reqBody?.internal_event === 'a2ui_callback';
    const rawFrom = String(reqBody?.From || reqBody?.phone || '');
    const toNumber = String(reqBody?.To || Deno.env.get('MARKETER_WHATSAPP_NUMBER') || '+260768737233');
    const rawBody = String(reqBody?.Body || '');
    const profileName = String(reqBody?.ProfileName || '');
    const mediaFiles: InboundMedia[] = Array.isArray(reqBody?.mediaFiles) ? reqBody.mediaFiles : [];
    const callbackCompanyId = typeof reqBody?.company_id === 'string' ? reqBody.company_id : null;
    const callbackEventType = typeof reqBody?.event_type === 'string' ? reqBody.event_type : '';
    const callbackPayload = (reqBody?.payload && typeof reqBody.payload === 'object') ? reqBody.payload : {};

    const phone = normalizeDigits(rawFrom);
    if (!phone) {
      return jsonRes({ error: 'Sender phone missing' }, 400);
    }

    // 1. Resolve all subscriptions belonging to this WhatsApp phone
    const { data: subsRaw, error: subErr } = await supabase
      .from('marketer_subscriptions')
      .select('*, companies(id, name, business_type, services, hours, quick_reference_info, metadata)')
      .eq('primary_whatsapp_phone', phone)
      .order('created_at', { ascending: true });

    if (subErr) {
      console.error('[marketer-agent] Subscription lookup error:', subErr);
      return jsonRes({ error: subErr.message }, 500);
    }

    const subscriptions = (subsRaw || []) as unknown as SubWithCompany[];

    // Unknown phone -> offer live Pitch Demo if DEMO/PITCH, else polite welcome
    if (subscriptions.length === 0) {
      const upper = rawBody.trim().toUpperCase();
      if (upper.startsWith('DEMO') || upper.startsWith('PITCH')) {
        await runPitchDemoTurn({ supabase, supabaseUrl, phone, toNumber, body: rawBody, mediaFiles });
        return jsonRes({ ok: true, mode: 'pitch_demo' });
      }
      if (upper.startsWith('MARKETER')) {
        await sendMarketerWhatsApp({
          to: phone,
          fromOverride: toNumber,
          body: `✨ *Welcome to Omanut AI Social Marketer!*\n\nTry a free 30-second campaign preview right now by replying:\n*DEMO Your Business Name* (and attach a product photo if you have one!)\n\nAlready signed up? Ask your Omanut representative to activate *+${phone}* in Admin → Marketer SaaS.`,
        });
        return jsonRes({ ok: true, mode: 'marketer_intro' });
      }
      await sendMarketerWhatsApp({
        to: phone,
        fromOverride: toNumber,
        body: `👋 Welcome to *Omanut AI Social Marketer*!\n\nThis shared WhatsApp line is dedicated to active Omanut Social Marketer businesses.\n\n• Want to try a live 30-second sample right now? Reply:\n  *DEMO Your Business Name* (you can attach a product photo too!)\n• Already paid for setup? Ask your Omanut representative to activate your number (+${phone}).`,
      });
      return jsonRes({ ok: true, mode: 'unregistered' });
    }

    // 2. Load/resolve session & multi-brand switching
    const { data: existingSession } = await supabase
      .from('marketer_sessions')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    let activeSub: SubWithCompany | undefined = subscriptions[0];

    if (isInternalEvent && callbackCompanyId) {
      activeSub = subscriptions.find((s) => s.company_id === callbackCompanyId) || subscriptions[0];
    } else if (subscriptions.length > 1) {
      const trimmedLower = rawBody.trim().toLowerCase();
      const wantsSwitch = trimmedLower === 'switch' || trimmedLower === 'brands' || trimmedLower === 'switch brand';
      const inSwitchMode = existingSession?.mode === 'brand_switch';
      const numChoice = parseInt(trimmedLower, 10);

      if (inSwitchMode && !Number.isNaN(numChoice) && numChoice >= 1 && numChoice <= subscriptions.length) {
        const chosen = subscriptions[numChoice - 1];
        await supabase.from('marketer_sessions').upsert({
          phone,
          active_company_id: chosen.company_id,
          mode: 'marketer',
          last_message_at: new Date().toISOString(),
        });
        await sendMarketerWhatsApp({
          to: phone,
          fromOverride: toNumber,
          body: `✅ Switched active brand to *${chosen.companies?.name || 'Selected Brand'}*.\n\nWhat are we creating or scheduling today?`,
        });
        return jsonRes({ ok: true, switched_to: chosen.company_id });
      }

      if (wantsSwitch || !existingSession?.active_company_id) {
        await supabase.from('marketer_sessions').upsert({
          phone,
          active_company_id: existingSession?.active_company_id || subscriptions[0].company_id,
          mode: 'brand_switch',
          last_message_at: new Date().toISOString(),
        });
        const list = subscriptions
          .map((s, idx) => `${idx + 1}. *${s.companies?.name || 'Brand'}* (${s.status})`)
          .join('\n');
        await sendMarketerWhatsApp({
          to: phone,
          fromOverride: toNumber,
          body: `You manage multiple brands on Omanut Social Marketer. Reply with the number to select:\n\n${list}`,
        });
        return jsonRes({ ok: true, mode: 'brand_switch' });
      }

      activeSub = subscriptions.find((s) => s.company_id === existingSession.active_company_id) || subscriptions[0];
    }

    if (!activeSub || !activeSub.companies) {
      return jsonRes({ error: 'Company record missing for subscriber' }, 404);
    }

    const company = activeSub.companies;

    // 3. Enforce subscription gate
    const gate = await checkMarketerQuota(supabase, activeSub, 'chat');
    activeSub = { ...gate.refreshedSub, companies: company };
    if (!gate.allowed && !isInternalEvent) {
      await sendMarketerWhatsApp({ to: phone, fromOverride: toNumber, body: gate.reason || 'Subscription paused.' });
      return jsonRes({ ok: true, blocked: 'subscription_paused' });
    }

    // 4. Intake Pipeline: Voice Notes -> Gemini Transcript; Photos/Videos -> Vault + Vision + Embeddings
    let effectiveUserText = rawBody.trim();
    const uploadedVaultSummary: Array<{ id: string; url: string; mediaType: string; description: string; qualityScore: number | null; hooks: string[] }> = [];
    const inspirationNotes: string[] = [];
    const outboundMediaUrls: string[] = [];

    if (!isInternalEvent && mediaFiles.length > 0) {
      const lowerText = rawBody.toLowerCase();
      const isInspirationRequest = /\b(like this|similar to|recreate|inspired by|competitor|do this style|make one like)\b/.test(lowerText);

      for (const m of mediaFiles) {
        try {
          const { bytes, contentType } = await downloadTwilioMedia(m.url);

          if (contentType.startsWith('audio/')) {
            const transcript = await transcribeAudioViaGemini(bytes, contentType);
            if (transcript) {
              effectiveUserText = effectiveUserText
                ? `${effectiveUserText}\n[Voice note transcript]: "${transcript}"`
                : `[Voice note transcript]: "${transcript}"`;
            } else {
              effectiveUserText += '\n[Boss sent a voice note that could not be transcribed clearly.]';
            }
            continue;
          }

          if (contentType.startsWith('image/') && isInspirationRequest) {
            const inspo = await analyzeInspirationImage(bytes, contentType, rawBody);
            if (inspo) inspirationNotes.push(inspo);
            continue;
          }

          if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
            const isVideo = contentType.startsWith('video/');
            const ext = extFromMime(contentType);
            const fileName = `wa-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
            const filePath = `vault/${company.id}/${fileName}`;

            const { error: upErr } = await supabase.storage
              .from('company-media')
              .upload(filePath, bytes, { contentType: contentType.split(';')[0], upsert: false });

            if (upErr) {
              console.error('[marketer-agent] Vault upload error:', upErr);
              continue;
            }

            const { data: pub } = supabase.storage.from('company-media').getPublicUrl(filePath);
            const publicUrl = pub.publicUrl;

            let category = 'products';
            let description = isVideo ? `Video uploaded via WhatsApp (${fileName})` : `Photo uploaded via WhatsApp (${fileName})`;
            let tags: string[] = [];
            let qualityScore: number | null = null;
            let recommendedFormat: string | null = isVideo ? 'reel' : 'feed';
            let hooks: string[] = [];

            if (!isVideo && bytes.byteLength < 6 * 1024 * 1024) {
              try {
                const dataUrl = `data:${contentType.split(';')[0]};base64,${encodeBase64(bytes)}`;
                const anRes = await fetch(`${supabaseUrl}/functions/v1/analyze-media`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    imageDataUrl: dataUrl,
                    fileName,
                    fileType: contentType,
                    businessType: company.business_type || 'business',
                  }),
                });
                if (anRes.ok) {
                  const an = await anRes.json();
                  if (typeof an.category === 'string' && VALID_MEDIA_CATEGORIES.has(an.category)) category = an.category;
                  if (typeof an.description === 'string' && an.description) description = an.description;
                  if (Array.isArray(an.tags)) tags = an.tags.map(String).slice(0, 8);
                  if (typeof an.quality_score === 'number') qualityScore = an.quality_score;
                  if (typeof an.recommended_format === 'string') recommendedFormat = an.recommended_format;
                  if (Array.isArray(an.ai_hook_suggestions)) hooks = an.ai_hook_suggestions.map(String).slice(0, 3);
                }
              } catch (e) {
                console.warn('[marketer-agent] analyze-media failed (non-fatal):', e);
              }
            }

            const { data: insertedMedia, error: mediaInsertErr } = await supabase
              .from('company_media')
              .insert({
                company_id: company.id,
                file_name: fileName,
                file_path: filePath,
                file_size: bytes.byteLength,
                file_type: contentType.split(';')[0],
                media_type: isVideo ? 'video' : 'image',
                category,
                description,
                tags,
                asset_validation_status: 'approved',
                vault_status: 'ready',
                source_channel: 'whatsapp',
                quality_score: qualityScore,
                recommended_format: recommendedFormat,
                ai_hook_suggestions: hooks,
              })
              .select('id')
              .single();

            if (!mediaInsertErr && insertedMedia) {
              uploadedVaultSummary.push({
                id: insertedMedia.id,
                url: publicUrl,
                mediaType: isVideo ? 'video' : 'image',
                description,
                qualityScore,
                hooks,
              });
              if (!isVideo) {
                fetch(`${supabaseUrl}/functions/v1/index-brand-asset`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ media_id: insertedMedia.id, company_id: company.id }),
                }).catch(() => {});
              }
            }
          }
        } catch (mediaErr) {
          console.error('[marketer-agent] Inbound media processing error:', mediaErr);
        }
      }
    }

    if (isInternalEvent) {
      effectiveUserText = `[INTERNAL A2UI CALLBACK: ${callbackEventType}] The client just submitted this inside their mobile studio: ${JSON.stringify(callbackPayload)}. Acknowledge warmly, summarize the exact next step or generated draft/schedule clearly for WhatsApp, and execute any required tools cleanly.`;
    } else {
      if (uploadedVaultSummary.length > 0) {
        const lines = uploadedVaultSummary
          .map(
            (u) =>
              `- Vault ID ${u.id} (${u.mediaType}${u.qualityScore ? `, score ${u.qualityScore}/10` : ''}): ${u.description}. URL: ${u.url}${u.hooks.length ? ` | Suggested hooks: ${u.hooks.join(' / ')}` : ''}`
          )
          .join('\n');
        effectiveUserText = `${effectiveUserText || 'I just sent content for my social media.'}\n\n[Saved to Content Vault just now]:\n${lines}`;
      }
      if (inspirationNotes.length > 0) {
        effectiveUserText = `${effectiveUserText}\n\n[Competitor / Inspiration Breakdown (Spy & Inspire)]:\n${inspirationNotes.join('\n')}`;
      }
    }

    if (!effectiveUserText.trim()) {
      effectiveUserText = 'Hello!';
    }

    // 5. Load rich company context in parallel
    const effectiveUserId = await resolveEffectiveUserId(supabase, company.id, activeSub.provisioned_by);
    const [
      brandKitRes,
      imgSettingsRes,
      identityRes,
      metaCredsRes,
      socialCredsRes,
      historyRes,
      vaultStatsRes,
      upcomingPostsRes,
    ] = await Promise.all([
      supabase.from('brand_kits').select('*').eq('company_id', company.id).maybeSingle(),
      supabase.from('image_generation_settings').select('*').eq('company_id', company.id).maybeSingle(),
      supabase.from('product_identity_profiles').select('product_name, hex_colors, label_text, packaging_shape').eq('company_id', company.id).eq('is_active', true).limit(6),
      supabase.from('meta_credentials').select('id, page_id, page_name, ig_user_id, access_token, health_status').eq('company_id', company.id),
      supabase.from('social_credentials').select('id, platform, account_id, account_name').eq('company_id', company.id),
      supabase.from('marketer_messages').select('role, content').eq('company_id', company.id).eq('phone', phone).order('created_at', { ascending: false }).limit(12),
      supabase.from('company_media').select('id, vault_status, media_type').eq('company_id', company.id).neq('vault_status', 'archived'),
      supabase.from('scheduled_posts').select('id, content, target_platform, scheduled_time, status').eq('company_id', company.id).in('status', ['draft', 'pending_approval', 'approved', 'scheduled']).order('scheduled_time', { ascending: true }).limit(6),
    ]);

    const brandKit = brandKitRes.data;
    const imgSettings = imgSettingsRes.data;
    const identities = identityRes.data || [];
    const metaCreds = metaCredsRes.data || [];
    const socialCreds = socialCredsRes.data || [];
    const recentMsgs = (historyRes.data || []).reverse();
    const vaultRows = vaultStatsRes.data || [];
    const readyCount = vaultRows.filter((v) => v.vault_status === 'ready' || v.vault_status === 'evergreen').length;
    const postedCount = vaultRows.filter((v) => v.vault_status === 'posted').length;
    const upcomingPosts = upcomingPostsRes.data || [];

    const nowLusaka = lusakaNowDisplay();
    const brandBlock = buildBrandBlock(brandKit);
    const connectedSummary = [
      metaCreds.length > 0
        ? metaCreds.map((m) => `Facebook Page "${m.page_name || m.page_id}"${m.ig_user_id ? ' + Instagram Business' : ' (no IG linked)'}`).join('; ')
        : 'Meta (Facebook/Instagram): NOT CONNECTED',
      socialCreds.length > 0
        ? socialCreds.map((s) => `${s.platform}: ${s.account_name || s.account_id}`).join('; ')
        : 'TikTok/LinkedIn: Not connected',
    ].join('\n');

    const pendingDraft = (existingSession?.pending_draft && typeof existingSession.pending_draft === 'object')
      ? existingSession.pending_draft as Record<string, unknown>
      : {};

    const systemPrompt = `You are *${company.name}'s* dedicated AI Social Media Marketer on Omanut.
You speak directly to ${activeSub.contact_name || profileName || 'the business owner'} on WhatsApp.

MISSION:
Make social media feel effortless, personal, and genuinely effective. You brainstorm ideas, analyze photos/videos they send, curate their Content Vault, generate brand-locked graphics and Seedance 2.5 Reels, discuss which content should go first, and publish or schedule posts cleanly.

CURRENT CONTEXT (${nowLusaka.dayName} ${nowLusaka.isoLocal}, Africa/Lusaka GMT+2):
- Business: ${company.name} (${company.business_type || 'Business'})
- Services / Offerings: ${company.services || 'Not set yet'}
- Operating Hours: ${company.hours || 'Not set'}
- Connected Social Accounts:
${connectedSummary}
- Content Vault: ${readyCount} ready/evergreen assets | ${postedCount} previously posted assets | ${upcomingPosts.length} upcoming scheduled/draft posts
- Monthly Subscription Usage: Posts ${activeSub.usage_posts_used}/${activeSub.monthly_posts_limit} | AI Images ${activeSub.usage_images_used}/${activeSub.monthly_images_limit} | AI Videos ${activeSub.usage_videos_used}/${activeSub.monthly_videos_limit} | Autopilot: ${activeSub.autopilot_level}
${brandBlock ? `\nBRAND DNA:\n${brandBlock}` : ''}
${imgSettings?.style_description ? `\nVISUAL STYLE GUIDE: ${imgSettings.style_description}` : ''}
${identities.length ? `\nPRODUCT IDENTITY LOCKS:\n${identities.map((p) => `- ${p.product_name}: colors ${(p.hex_colors || []).join(',')} | label: ${p.label_text || 'n/a'}`).join('\n')}` : ''}
${Object.keys(pendingDraft).length ? `\nACTIVE PENDING DRAFT IN MEMORY:\n${JSON.stringify(pendingDraft)}` : ''}

CRITICAL BEHAVIOR & WHATSAPP UX RULES:
1. NEVER say you posted or scheduled something unless \`schedule_or_publish_post\` or \`list_or_manage_schedule\` actually succeeded in this turn.
2. When no social account is connected and the owner wants to connect or publish, call \`spawn_a2ui_surface\` with \`surface_type: "connect_hub"\` and send them the 1-tap zero-login link right in your reply!
3. When the owner asks to upload existing content/photos/videos, or asks *"which should go first"* / *"help me pick from my vault"*, actively combine smart chat recommendations WITH \`spawn_a2ui_surface\` (\`vault_uploader\` or \`vault_prioritizer\`) or \`curate_vault\` with \`attach_previews: true\` so they can visually inspect & rank effortlessly!
4. When the owner asks to see their week calendar, grid, or approve scheduled posts visually, call \`spawn_a2ui_surface\` with \`surface_type: "calendar_grid"\`.
5. When generating images or videos, NEVER leak internal UUIDs or raw prompts unless helpful; show a clear next step: e.g. *"Reply POST to publish now, SCHEDULE <time>, or TWEAK <what to change>."*
6. For Lusaka/Zambian context: understand Kwacha (K / ZMW), payday cycles (25th–3rd), local neighbourhoods (Kabulonga, East Park, Manda Hill, Roma, Kitwe, Ndola, etc.), and local holidays without sounding robotic.
7. Format strictly for WhatsApp: concise, warm, punchy, *single asterisks* for bold, bullet lists, clear numbered options (\`1.\`, \`2.\`, \`3.\`). Keep replies focused and easy to read on a phone screen.`;

    const tools = [
      {
        type: 'function',
        function: {
          name: 'curate_vault',
          description: 'Search and rank ready/evergreen photos and videos in the Content Vault so we can pick the best asset or discuss which should go first. Can optionally attach up to 3 preview thumbnails directly to the WhatsApp reply.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Optional topic or product filter' },
              limit: { type: 'number', description: 'Number of assets to return (default 6, max 12)' },
              attach_previews: { type: 'boolean', description: 'If true, attach up to 3 top photo URLs directly to the WhatsApp message' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'spawn_a2ui_surface',
          description: 'Spawn a passwordless mobile studio A2UI link inside WhatsApp for visual/bulk workflows. Always use the right surface_type for what the owner asked.',
          parameters: {
            type: 'object',
            properties: {
              surface_type: {
                type: 'string',
                enum: ['vault_uploader', 'vault_prioritizer', 'calendar_grid', 'creative_studio', 'connect_hub', 'brand_dna', 'onboarding_hub'],
              },
              headline: { type: 'string', description: 'Short instruction banner shown inside the mobile studio' },
              highlighted_asset_ids: { type: 'array', items: { type: 'string' } },
              suggested_note: { type: 'string' },
            },
            required: ['surface_type'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_brand_image',
          description: 'Generate a brand-locked graphic or product promo image for the business using their Brand DNA and optional reference Vault photos.',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Detailed visual creative direction referencing exact product, lighting, composition, mood, and any headline/offer' },
              reference_asset_ids: { type: 'array', items: { type: 'string' }, description: 'Optional Vault media IDs to anchor the real product' },
              reference_image_urls: { type: 'array', items: { type: 'string' }, description: 'Optional Vault/image URLs to anchor' },
              draft_caption: { type: 'string', description: 'Suggested social caption paired with this graphic' },
            },
            required: ['prompt'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_brand_video',
          description: 'Create an AI marketing video / Reel using Omanut Motion (Seedance 2.5). Renders asynchronously (~60-90s) and automatically delivers the MP4 straight back to this WhatsApp chat.',
          parameters: {
            type: 'object',
            properties: {
              brief: { type: 'string', description: 'Short commercial brief describing hook, product, motion feel, and CTA' },
              input_image_url: { type: 'string', description: 'Optional hero photo URL from Vault or generated image to animate' },
              reference_image_urls: { type: 'array', items: { type: 'string' } },
              aspect_ratio: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
              duration: { type: 'string', enum: ['5', '10'] },
            },
            required: ['brief'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'schedule_or_publish_post',
          description: 'Publish a post immediately OR schedule it for later in Africa/Lusaka timezone. Always verify platform connection first.',
          parameters: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Final post caption / text' },
              platform: { type: 'string', enum: ['both', 'facebook', 'instagram', 'tiktok', 'linkedin'] },
              publish_now: { type: 'boolean', description: 'True to publish immediately; false to schedule' },
              scheduled_time_lusaka: { type: 'string', description: 'Africa/Lusaka time e.g. "2026-11-28 17:30". Required if publish_now is false.' },
              image_url: { type: 'string', description: 'Optional single image URL' },
              image_urls: { type: 'array', items: { type: 'string' }, description: 'Optional multi-photo/carousel URLs' },
              video_url: { type: 'string', description: 'Optional MP4 video URL' },
              vault_asset_id: { type: 'string', description: 'Optional Vault company_media ID used for this post so we mark it posted/scheduled' },
              requires_approval: { type: 'boolean', description: 'If true, saves as pending_approval instead of auto-publishing approved' },
            },
            required: ['content', 'platform', 'publish_now'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_or_manage_schedule',
          description: 'View upcoming scheduled/pending posts, approve all pending posts (approve_week), reschedule a post, update caption, or cancel a post.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'approve_week', 'approve_one', 'reschedule', 'edit_caption', 'cancel'] },
              post_id: { type: 'string' },
              new_scheduled_time_lusaka: { type: 'string' },
              new_caption: { type: 'string' },
            },
            required: ['action'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'audit_social_page',
          description: 'Inspect the connected Facebook/Instagram pages and posting cadence to deliver a concrete performance audit and best-time-to-post advice.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'update_brand_dna',
          description: 'Update the brand tone, guidelines, no-go phrases, or visual style based on what the owner tells you.',
          parameters: {
            type: 'object',
            properties: {
              tone: { type: 'string' },
              guidelines: { type: 'string' },
              no_go_phrases: { type: 'string' },
              style_description: { type: 'string' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'set_autopilot_level',
          description: 'Change how autonomous the AI Marketer is: copilot (approve every post), weekly_batch (approve weekly batch on Monday), full_autopilot (auto-queue with 2h veto preview).',
          parameters: {
            type: 'object',
            properties: {
              level: { type: 'string', enum: ['copilot', 'weekly_batch', 'full_autopilot'] },
            },
            required: ['level'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_account_status',
          description: 'Get subscription limits, monthly usage remaining, renewal date, connected channels, and Vault counts.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const messages: Array<{ role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }> = [
      { role: 'system', content: systemPrompt },
      ...recentMsgs.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: effectiveUserText },
    ];

    let finalReply = '';
    const updatedPendingDraft: Record<string, unknown> = { ...pendingDraft };
    const spawnedLinks: string[] = [];

    for (let iter = 0; iter < 5; iter++) {
      const llmRes = await geminiChatWithFallback({
        model: PRIMARY_TEXT_MODEL,
        messages: messages as Array<{ role: string; content: unknown }>,
        tools,
        tool_choice: 'auto',
        temperature: 0.65,
        max_tokens: 1400,
      });

      if (!llmRes.ok) {
        console.error('[marketer-agent] LLM error:', llmRes.status, await llmRes.text().catch(() => ''));
        break;
      }

      const llmJson = await llmRes.json().catch(() => ({}));
      const choiceMsg = llmJson?.choices?.[0]?.message;
      if (!choiceMsg) break;

      const toolCalls = Array.isArray(choiceMsg.tool_calls) ? choiceMsg.tool_calls : [];
      if (toolCalls.length === 0) {
        finalReply = String(choiceMsg.content || '').trim();
        break;
      }

      messages.push({
        role: 'assistant',
        content: choiceMsg.content || '',
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const fnName = String(tc?.function?.name || '');
        let args: Record<string, unknown> = {};
        try {
          args = tc?.function?.arguments ? JSON.parse(String(tc.function.arguments)) : {};
        } catch {
          args = {};
        }

        let toolOutput: Record<string, unknown> = {};

        try {
          if (fnName === 'curate_vault') {
            const limit = Math.min(Math.max(Number(args.limit || 6), 1), 12);
            const q = String(args.query || '').trim().toLowerCase();
            const { data: items } = await supabase
              .from('company_media')
              .select('id, file_name, file_path, media_type, category, description, tags, quality_score, recommended_format, ai_hook_suggestions, vault_status, times_posted, priority_rank, created_at')
              .eq('company_id', company.id)
              .in('vault_status', ['ready', 'evergreen', 'raw'])
              .order('priority_rank', { ascending: true, nullsFirst: false })
              .order('quality_score', { ascending: false, nullsFirst: false })
              .order('created_at', { ascending: false })
              .limit(30);

            let filtered = items || [];
            if (q) {
              const matches = filtered.filter((it) => {
                const hay = `${it.file_name} ${it.description || ''} ${it.category} ${(it.tags || []).join(' ')}`.toLowerCase();
                return hay.includes(q);
              });
              if (matches.length > 0) filtered = matches;
            }
            const top = filtered.slice(0, limit).map((it) => {
              const { data: pub } = supabase.storage.from('company-media').getPublicUrl(it.file_path);
              return {
                id: it.id,
                file_name: it.file_name,
                media_type: it.media_type,
                category: it.category,
                description: it.description,
                quality_score: it.quality_score,
                recommended_format: it.recommended_format,
                hooks: it.ai_hook_suggestions,
                times_posted: it.times_posted,
                url: pub.publicUrl,
              };
            });
            if (args.attach_previews === true) {
              for (const it of top.filter((x) => x.media_type === 'image').slice(0, 3)) {
                if (!outboundMediaUrls.includes(it.url)) outboundMediaUrls.push(it.url);
              }
            }
            toolOutput = { count: top.length, assets: top };
          } else if (fnName === 'spawn_a2ui_surface') {
            const surface = String(args.surface_type || 'vault_uploader') as A2UISurfaceType;
            const spawned = await createSignedA2UISession(supabase, {
              companyId: company.id,
              phone,
              surfaceType: surface,
              uiSpec: {
                headline: args.headline || null,
                highlighted_asset_ids: Array.isArray(args.highlighted_asset_ids) ? args.highlighted_asset_ids : [],
                suggested_note: args.suggested_note || null,
              },
            });
            await supabase
              .from('marketer_sessions')
              .upsert({ phone, active_company_id: company.id, last_a2ui_session_id: spawned.sessionId });
            spawnedLinks.push(spawned.url);
            toolOutput = { ok: true, studio_url: spawned.url, expires_at: spawned.expiresAt, surface_type: surface };
          } else if (fnName === 'generate_brand_image') {
            const imgGate = await checkMarketerQuota(supabase, activeSub, 'image');
            if (!imgGate.allowed) {
              toolOutput = { ok: false, error: imgGate.reason };
            } else {
              // Ensure image_generation_settings row is enabled so generate-business-image works seamlessly
              if (!imgSettings?.enabled) {
                await supabase.from('image_generation_settings').upsert({
                  company_id: company.id,
                  enabled: true,
                  brand_tone: brandKit?.tone || null,
                  style_description: company.business_type ? `Professional brand visuals for ${company.name} (${company.business_type})` : null,
                }, { onConflict: 'company_id' });
              }

              const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-business-image`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  company_id: company.id,
                  prompt: String(args.prompt || ''),
                  reference_image_ids: Array.isArray(args.reference_asset_ids) ? args.reference_asset_ids : undefined,
                  reference_image_urls: Array.isArray(args.reference_image_urls) ? args.reference_image_urls : undefined,
                  auto_select_products: true,
                }),
              });
              const genJson = await genRes.json().catch(() => ({}));
              if (!genRes.ok || !genJson?.image_url) {
                toolOutput = { ok: false, error: genJson?.error || `Image generation failed (${genRes.status})` };
              } else {
                await incrementMarketerUsage(supabase, activeSub.id, 'image');
                activeSub.usage_images_used += 1;
                outboundMediaUrls.push(genJson.image_url);
                updatedPendingDraft.image_url = genJson.image_url;
                updatedPendingDraft.caption = args.draft_caption || '';
                updatedPendingDraft.type = 'image';

                // Also mirror into company_media so it appears in Creative Studio & Vault
                const storagePathMatch = String(genJson.image_url).split('/company-media/')[1];
                if (storagePathMatch) {
                  await supabase.from('company_media').insert({
                    company_id: company.id,
                    file_name: `ai-${Date.now()}.png`,
                    file_path: storagePathMatch,
                    file_size: 0,
                    file_type: 'image/png',
                    media_type: 'image',
                    category: 'promotional',
                    description: String(args.prompt || '').slice(0, 220),
                    asset_validation_status: 'approved',
                    vault_status: 'ready',
                    source_channel: 'ai_generated',
                  }).catch(() => {});
                }

                toolOutput = {
                  ok: true,
                  image_url: genJson.image_url,
                  usage_images_used: activeSub.usage_images_used,
                  monthly_images_limit: activeSub.monthly_images_limit,
                };
              }
            }
          } else if (fnName === 'generate_brand_video') {
            const vidGate = await checkMarketerQuota(supabase, activeSub, 'video');
            if (!vidGate.allowed) {
              toolOutput = { ok: false, error: vidGate.reason };
            } else {
              const motionRes = await fetch(`${supabaseUrl}/functions/v1/omanut-motion`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  company_id: company.id,
                  brief: String(args.brief || ''),
                  aspect_ratio: String(args.aspect_ratio || '9:16'),
                  duration: String(args.duration || '5'),
                  input_image_url: args.input_image_url || updatedPendingDraft.image_url || null,
                  image_urls: Array.isArray(args.reference_image_urls) ? args.reference_image_urls : null,
                  delivery_channel: 'marketer_hub',
                  boss_phone: `whatsapp:+${phone}`,
                }),
              });
              const motionJson = await motionRes.json().catch(() => ({}));
              if (!motionRes.ok) {
                toolOutput = { ok: false, error: motionJson?.error || `Video generation error (${motionRes.status})` };
              } else {
                await incrementMarketerUsage(supabase, activeSub.id, 'video');
                activeSub.usage_videos_used += 1;
                toolOutput = {
                  ok: true,
                  job_id: motionJson.job_id,
                  style: motionJson.style,
                  hook: motionJson.hook,
                  cta: motionJson.cta,
                  status: 'rendering',
                  eta_seconds: '60-120',
                };
              }
            }
          } else if (fnName === 'schedule_or_publish_post') {
            const postGate = await checkMarketerQuota(supabase, activeSub, 'post');
            if (!postGate.allowed) {
              toolOutput = { ok: false, error: postGate.reason };
            } else {
              const platform = String(args.platform || 'both');
              let targetPageId = '';
              if (platform === 'tiktok' || platform === 'linkedin') {
                const sc = socialCreds.find((s) => s.platform === platform);
                if (!sc) {
                  const spawned = await createSignedA2UISession(supabase, {
                    companyId: company.id,
                    phone,
                    surfaceType: 'connect_hub',
                  });
                  toolOutput = {
                    ok: false,
                    needs_connection: platform,
                    connect_url: spawned.url,
                    message: `${platform} is not connected yet. Share this 1-tap connect link with the owner: ${spawned.url}`,
                  };
                } else {
                  targetPageId = sc.account_id;
                }
              } else {
                const mc = metaCreds[0];
                if (!mc) {
                  const spawned = await createSignedA2UISession(supabase, {
                    companyId: company.id,
                    phone,
                    surfaceType: 'connect_hub',
                  });
                  toolOutput = {
                    ok: false,
                    needs_connection: 'meta',
                    connect_url: spawned.url,
                    message: `Facebook / Instagram is not connected yet. Share this 1-tap connect link with the owner: ${spawned.url}`,
                  };
                } else {
                  if (platform === 'instagram' && !mc.ig_user_id) {
                    toolOutput = {
                      ok: false,
                      error: `Facebook Page "${mc.page_name || mc.page_id}" does not have an Instagram Business Account linked.`,
                    };
                  } else {
                    targetPageId = mc.page_id;
                  }
                }
              }

              if (targetPageId) {
                const publishNow = Boolean(args.publish_now);
                const imageUrlsArr = Array.isArray(args.image_urls)
                  ? args.image_urls.map(String).filter(Boolean)
                  : args.image_url
                  ? [String(args.image_url)]
                  : updatedPendingDraft.image_url && !args.video_url
                  ? [String(updatedPendingDraft.image_url)]
                  : [];
                const videoUrl = args.video_url ? String(args.video_url) : (updatedPendingDraft.video_url ? String(updatedPendingDraft.video_url) : null);

                if (platform === 'instagram' && imageUrlsArr.length === 0 && !videoUrl) {
                  toolOutput = { ok: false, error: 'Instagram requires at least one image or video URL.' };
                } else {
                  const scheduledTimeUtc = publishNow
                    ? new Date().toISOString()
                    : parseLusakaTimeToUtcIso(String(args.scheduled_time_lusaka || ''));
                  const statusToInsert = publishNow
                    ? 'approved'
                    : args.requires_approval
                    ? 'pending_approval'
                    : 'approved';

                  const { data: postRow, error: insErr } = await supabase
                    .from('scheduled_posts')
                    .insert({
                      company_id: company.id,
                      page_id: targetPageId,
                      content: String(args.content || ''),
                      scheduled_time: scheduledTimeUtc,
                      status: statusToInsert,
                      target_platform: platform,
                      image_url: imageUrlsArr[0] || null,
                      image_urls: imageUrlsArr.length ? imageUrlsArr : null,
                      video_url: videoUrl,
                      created_by: effectiveUserId,
                      metadata: {
                        source: 'whatsapp_marketer',
                        vault_asset_id: args.vault_asset_id || null,
                      },
                    })
                    .select('id')
                    .single();

                  if (insErr || !postRow) {
                    toolOutput = { ok: false, error: insErr?.message || 'Failed to save post' };
                  } else if (publishNow) {
                    const pubRes = await fetch(`${supabaseUrl}/functions/v1/publish-meta-post`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ post_id: postRow.id }),
                    });
                    const pubJson = await pubRes.json().catch(() => ({}));
                    if (pubRes.ok && pubJson?.success) {
                      await incrementMarketerUsage(supabase, activeSub.id, 'post');
                      if (args.vault_asset_id) {
                        const { data: curAsset } = await supabase.from('company_media').select('times_posted').eq('id', String(args.vault_asset_id)).maybeSingle();
                        await supabase.from('company_media').update({
                          vault_status: 'posted',
                          times_posted: Number(curAsset?.times_posted || 0) + 1,
                          last_posted_at: new Date().toISOString(),
                        }).eq('id', String(args.vault_asset_id)).eq('company_id', company.id);
                      }
                      delete updatedPendingDraft.image_url;
                      delete updatedPendingDraft.video_url;
                      delete updatedPendingDraft.caption;
                      toolOutput = { ok: true, published: true, post_id: postRow.id, platform, meta_post_id: pubJson.meta_post_id || null };
                    } else {
                      await supabase.from('scheduled_posts').update({ status: 'failed', error_message: pubJson?.error || `HTTP ${pubRes.status}` }).eq('id', postRow.id);
                      toolOutput = { ok: false, published: false, error: pubJson?.error || `Publish failed (${pubRes.status})` };
                    }
                  } else {
                    await incrementMarketerUsage(supabase, activeSub.id, 'post');
                    if (args.vault_asset_id) {
                      await supabase.from('company_media').update({ vault_status: 'scheduled' }).eq('id', String(args.vault_asset_id)).eq('company_id', company.id);
                    }
                    delete updatedPendingDraft.image_url;
                    delete updatedPendingDraft.video_url;
                    delete updatedPendingDraft.caption;
                    toolOutput = {
                      ok: true,
                      scheduled: true,
                      post_id: postRow.id,
                      status: statusToInsert,
                      scheduled_time_utc: scheduledTimeUtc,
                      platform,
                    };
                  }
                }
              }
            }
          } else if (fnName === 'list_or_manage_schedule') {
            const act = String(args.action || 'list');
            if (act === 'list') {
              const { data: rows } = await supabase
                .from('scheduled_posts')
                .select('id, content, target_platform, scheduled_time, status, image_url, video_url')
                .eq('company_id', company.id)
                .in('status', ['draft', 'pending_approval', 'approved', 'scheduled'])
                .order('scheduled_time', { ascending: true })
                .limit(10);
              toolOutput = { posts: rows || [] };
            } else if (act === 'approve_week') {
              const { data: updatedRows } = await supabase
                .from('scheduled_posts')
                .update({ status: 'approved', updated_at: new Date().toISOString() })
                .eq('company_id', company.id)
                .in('status', ['draft', 'pending_approval'])
                .select('id');
              toolOutput = { ok: true, approved_count: updatedRows?.length || 0 };
            } else if (act === 'approve_one' && args.post_id) {
              await supabase.from('scheduled_posts').update({ status: 'approved' }).eq('id', String(args.post_id)).eq('company_id', company.id);
              toolOutput = { ok: true, post_id: args.post_id, status: 'approved' };
            } else if (act === 'reschedule' && args.post_id && args.new_scheduled_time_lusaka) {
              const utc = parseLusakaTimeToUtcIso(String(args.new_scheduled_time_lusaka));
              await supabase.from('scheduled_posts').update({ scheduled_time: utc }).eq('id', String(args.post_id)).eq('company_id', company.id);
              toolOutput = { ok: true, post_id: args.post_id, scheduled_time_utc: utc };
            } else if (act === 'edit_caption' && args.post_id && args.new_caption) {
              await supabase.from('scheduled_posts').update({ content: String(args.new_caption) }).eq('id', String(args.post_id)).eq('company_id', company.id);
              toolOutput = { ok: true, post_id: args.post_id };
            } else if (act === 'cancel' && args.post_id) {
              await supabase.from('scheduled_posts').delete().eq('id', String(args.post_id)).eq('company_id', company.id);
              toolOutput = { ok: true, cancelled_post_id: args.post_id };
            }
          } else if (fnName === 'audit_social_page') {
            const optRes = await fetch(`${supabaseUrl}/functions/v1/optimize-posting`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ company_id: company.id }),
            });
            const optJson = await optRes.json().catch(() => ({}));
            let recentMetaPosts: Array<Record<string, unknown>> = [];
            if (metaCreds[0]?.page_id && metaCreds[0]?.access_token) {
              try {
                const gRes = await fetch(
                  `https://graph.facebook.com/v19.0/${metaCreds[0].page_id}/posts?fields=message,created_time,likes.summary(true),comments.summary(true)&limit=10&access_token=${metaCreds[0].access_token}`
                );
                if (gRes.ok) {
                  const gJson = await gRes.json();
                  recentMetaPosts = Array.isArray(gJson.data)
                    ? gJson.data.map((p: Record<string, unknown>) => ({
                        created_time: p.created_time,
                        preview: typeof p.message === 'string' ? p.message.slice(0, 90) : '(media post)',
                        likes: ((p.likes as Record<string, unknown>)?.summary as Record<string, unknown>)?.total_count ?? 0,
                        comments: ((p.comments as Record<string, unknown>)?.summary as Record<string, unknown>)?.total_count ?? 0,
                      }))
                    : [];
                }
              } catch { /* non-fatal */ }
            }
            toolOutput = {
              connected_pages: metaCreds.map((m) => ({ page_name: m.page_name, has_ig: !!m.ig_user_id })),
              insights: optJson?.insights || null,
              recent_facebook_posts: recentMetaPosts,
            };
          } else if (fnName === 'update_brand_dna') {
            const kitPatch: Record<string, unknown> = { company_id: company.id, updated_at: new Date().toISOString() };
            if (args.tone) kitPatch.tone = String(args.tone);
            if (args.guidelines) kitPatch.guidelines = String(args.guidelines);
            if (args.no_go_phrases) kitPatch.no_go_phrases = String(args.no_go_phrases);
            await supabase.from('brand_kits').upsert(kitPatch, { onConflict: 'company_id' });
            if (args.style_description || args.tone) {
              await supabase.from('image_generation_settings').upsert({
                company_id: company.id,
                enabled: true,
                ...(args.tone ? { brand_tone: String(args.tone) } : {}),
                ...(args.style_description ? { style_description: String(args.style_description) } : {}),
              }, { onConflict: 'company_id' });
            }
            toolOutput = { ok: true, updated: true };
          } else if (fnName === 'set_autopilot_level') {
            const lvl = String(args.level || 'copilot');
            await supabase.from('marketer_subscriptions').update({ autopilot_level: lvl }).eq('id', activeSub.id);
            activeSub.autopilot_level = lvl as MarketerSubscriptionRow['autopilot_level'];
            toolOutput = { ok: true, autopilot_level: lvl };
          } else if (fnName === 'get_account_status') {
            toolOutput = {
              company_name: company.name,
              status: activeSub.status,
              autopilot_level: activeSub.autopilot_level,
              period_end: activeSub.current_period_end,
              usage: {
                posts: `${activeSub.usage_posts_used}/${activeSub.monthly_posts_limit}`,
                images: `${activeSub.usage_images_used}/${activeSub.monthly_images_limit}`,
                videos: `${activeSub.usage_videos_used}/${activeSub.monthly_videos_limit}`,
              },
              vault_ready_count: readyCount,
              vault_posted_count: postedCount,
              connected_meta: metaCreds.map((m) => ({ page_name: m.page_name, ig_linked: !!m.ig_user_id })),
              connected_social: socialCreds.map((s) => ({ platform: s.platform, account_name: s.account_name })),
            };
          } else {
            toolOutput = { error: `Unknown tool ${fnName}` };
          }
        } catch (toolErr) {
          toolOutput = { ok: false, error: toolErr instanceof Error ? toolErr.message : String(toolErr) };
        }

        messages.push({
          role: 'tool',
          tool_call_id: String(tc.id || fnName),
          content: JSON.stringify(toolOutput),
        });
      }
    }

    if (!finalReply) {
      finalReply =
        uploadedVaultSummary.length > 0
          ? `✅ Saved ${uploadedVaultSummary.length} item(s) to your Content Vault! Want me to suggest captions, create a graphic/Reel, or help pick which goes first?`
          : `I'm here for *${company.name}*! Send me photos/videos for your Content Vault, a voice note with an offer, or ask me to brainstorm this week's posts.`;
    }

    // Persist conversation logs & session memory
    await Promise.all([
      supabase.from('marketer_messages').insert([
        {
          company_id: company.id,
          phone,
          role: 'user',
          content: effectiveUserText,
          media_urls: mediaFiles.map((m) => m.url),
        },
        {
          company_id: company.id,
          phone,
          role: 'assistant',
          content: finalReply,
          media_urls: outboundMediaUrls,
          tool_context: { spawned_links: spawnedLinks },
        },
      ]),
      supabase.from('marketer_sessions').upsert({
        phone,
        active_company_id: company.id,
        mode: 'marketer',
        pending_draft: updatedPendingDraft,
        last_message_at: new Date().toISOString(),
      }),
    ]);

    const sendRes = await sendMarketerWhatsApp({
      to: phone,
      fromOverride: toNumber,
      body: finalReply,
      mediaUrls: outboundMediaUrls,
    });

    if (!sendRes.ok) {
      console.error('[marketer-agent] WhatsApp send failed:', sendRes.error);
    }

    return jsonRes({ ok: true, company_id: company.id, sent: sendRes.ok, media_sent: outboundMediaUrls.length });
  } catch (err) {
    console.error('[whatsapp-marketer-agent] fatal:', err);
    return jsonRes({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
