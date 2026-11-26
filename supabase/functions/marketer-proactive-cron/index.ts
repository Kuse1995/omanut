import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../_shared/gemini-client.ts';
import { buildBrandBlock } from '../_shared/marketing.ts';
import { createSignedA2UISession } from '../_shared/a2ui-token.ts';
import { sendMarketerWhatsApp } from '../_shared/marketer-twilio.ts';
import {
  checkMarketerQuota,
  MarketerSubscriptionRow,
  resolveEffectiveUserId,
} from '../_shared/marketer-billing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function lusakaSlotUtcIso(daysAhead: number, hour: number, minute = 0): string {
  // Africa/Lusaka is UTC+2 permanently
  const offsetMs = 2 * 60 * 60 * 1000;
  const nowLocal = new Date(Date.now() + offsetMs);
  const targetLocal = Date.UTC(
    nowLocal.getUTCFullYear(),
    nowLocal.getUTCMonth(),
    nowLocal.getUTCDate() + daysAhead,
    hour,
    minute,
    0,
    0
  );
  return new Date(targetLocal - offsetMs).toISOString();
}

function formatLusakaShort(isoUtc: string): string {
  const local = new Date(Date.parse(isoUtc) + 2 * 60 * 60 * 1000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${days[local.getUTCDay()]} ${hh}:${mm}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization') || '';
  const cronHeader = req.headers.get('X-Cron-Secret') || '';

  const isAuthorized =
    (cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)) ||
    authHeader === `Bearer ${serviceKey}`;

  if (!isAuthorized) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const jobType = String(body?.job_type || 'monday_kickoff');
    const targetCompanyId = typeof body?.company_id === 'string' && body.company_id ? body.company_id : null;

    let subQuery = supabase
      .from('marketer_subscriptions')
      .select('*, companies(id, name, business_type, services)')
      .in('status', ['active', 'grace_period']);

    if (targetCompanyId) {
      subQuery = subQuery.eq('company_id', targetCompanyId);
    }

    const { data: subsRaw, error: subErr } = await subQuery;
    if (subErr) throw subErr;

    const subs = (subsRaw || []) as unknown as Array<
      MarketerSubscriptionRow & { companies: { id: string; name: string; business_type: string | null; services: string | null } | null }
    >;

    const processed: Array<{ company_id: string; outcome: string }> = [];

    // ── JOB 1: MONDAY STRATEGY KICKOFF ────────────────────────────────────
    if (jobType === 'monday_kickoff') {
      for (const sub of subs) {
        if (!sub.companies) continue;
        try {
          const [vaultRes, metaRes, socialRes, kitRes] = await Promise.all([
            supabase
              .from('company_media')
              .select('id, file_path, media_type, description, tags, quality_score, ai_hook_suggestions')
              .eq('company_id', sub.company_id)
              .in('vault_status', ['ready', 'evergreen'])
              .order('priority_rank', { ascending: true, nullsFirst: false })
              .order('quality_score', { ascending: false, nullsFirst: false })
              .order('created_at', { ascending: false })
              .limit(3),
            supabase.from('meta_credentials').select('page_id, ig_user_id').eq('company_id', sub.company_id).limit(1).maybeSingle(),
            supabase.from('social_credentials').select('platform, account_id').eq('company_id', sub.company_id).limit(1).maybeSingle(),
            supabase.from('brand_kits').select('*').eq('company_id', sub.company_id).maybeSingle(),
          ]);

          const pageId = metaRes.data?.page_id || socialRes.data?.account_id;
          if (!pageId) {
            const connectSession = await createSignedA2UISession(supabase, {
              companyId: sub.company_id,
              phone: sub.primary_whatsapp_phone,
              surfaceType: 'connect_hub',
            });
            await sendMarketerWhatsApp({
              to: sub.primary_whatsapp_phone,
              body: `☀️ *Happy Monday, ${sub.contact_name || sub.companies.name}!*\n\nI'm ready to plan this week's posts for *${sub.companies.name}*, but your social account isn't linked yet.\n\nTap once below to connect Facebook / Instagram in 30 seconds:\n👉 ${connectSession.url}`,
            });
            processed.push({ company_id: sub.company_id, outcome: 'sent_connect_prompt' });
            continue;
          }

          const platform = metaRes.data?.page_id ? (metaRes.data.ig_user_id ? 'both' : 'facebook') : socialRes.data!.platform;
          const assets = vaultRes.data || [];
          const effectiveUserId = await resolveEffectiveUserId(supabase, sub.company_id, sub.provisioned_by);

          const assetNotes = assets
            .map((a, i) => `Asset ${i + 1}: ${a.description || 'Brand media'} (score ${a.quality_score ?? 'n/a'})`)
            .join('\n');

          let captions: string[] = [];
          try {
            const aiRes = await geminiChatWithFallback({
              model: PRIMARY_TEXT_MODEL,
              messages: [
                {
                  role: 'system',
                  content: `Draft 3 distinct, engaging social media captions for "${sub.companies.name}" (${sub.companies.business_type || 'business'}).
Services: ${sub.companies.services || 'n/a'}
${buildBrandBlock(kitRes.data)}
Return ONLY a JSON array of 3 strings, no markdown.`,
                },
                {
                  role: 'user',
                  content: assets.length
                    ? `Write 1 caption matching each of these 3 Vault items:\n${assetNotes}`
                    : `Write 3 varied posts: 1) Value/tip, 2) Product/service spotlight, 3) Strong weekend offer.`,
                },
              ],
              temperature: 0.7,
              max_tokens: 900,
            });
            if (aiRes.ok) {
              const j = await aiRes.json();
              const raw = String(j?.choices?.[0]?.message?.content || '').replace(/```json|```/gi, '').trim();
              const arrMatch = raw.match(/\[[\s\S]*\]/);
              if (arrMatch) {
                const parsed = JSON.parse(arrMatch[0]);
                if (Array.isArray(parsed)) captions = parsed.map(String).slice(0, 3);
              }
            }
          } catch {
            // Fallback captions below
          }

          if (captions.length < 3) {
            captions = [
              `✨ Start the week strong with *${sub.companies.name}*! DM us today to place your order or book your spot.`,
              `🌟 Customer favourite at *${sub.companies.name}*! Quality you can trust right here in town. Send us a message anytime.`,
              `🔥 Weekend plans sorted with *${sub.companies.name}*! Message us early so you don't miss out.`,
            ];
          }

          const slotOffsets = [
            { days: 1, hour: 17, min: 30 },
            { days: 3, hour: 12, min: 30 },
            { days: 5, hour: 10, min: 0 },
          ];

          const targetStatus = sub.autopilot_level === 'full_autopilot' ? 'approved' : 'pending_approval';
          const createdLines: string[] = [];

          for (let i = 0; i < 3; i++) {
            const asset = assets[i];
            const { data: pub } = asset?.file_path
              ? supabase.storage.from('company-media').getPublicUrl(asset.file_path)
              : { data: { publicUrl: null } };
            const isVid = asset?.media_type === 'video';
            const schedUtc = lusakaSlotUtcIso(slotOffsets[i].days, slotOffsets[i].hour, slotOffsets[i].min);

            await supabase.from('scheduled_posts').insert({
              company_id: sub.company_id,
              page_id: pageId,
              content: captions[i],
              scheduled_time: schedUtc,
              status: targetStatus,
              target_platform: platform,
              image_url: !isVid ? pub.publicUrl : null,
              image_urls: !isVid && pub.publicUrl ? [pub.publicUrl] : null,
              video_url: isVid ? pub.publicUrl : null,
              created_by: effectiveUserId,
              metadata: { source: 'monday_kickoff', vault_asset_id: asset?.id || null },
            });

            createdLines.push(`${i + 1}. *${formatLusakaShort(schedUtc)}* — ${captions[i].slice(0, 70)}...`);
          }

          const calSession = await createSignedA2UISession(supabase, {
            companyId: sub.company_id,
            phone: sub.primary_whatsapp_phone,
            surfaceType: 'calendar_grid',
            uiSpec: { headline: "Review & approve this week's social media lineup" },
          });

          const headerNote =
            targetStatus === 'approved'
              ? `All 3 are *queued on Full Autopilot* (you'll still get a 2h preview before each goes live).`
              : `Reply *"APPROVE ALL"* to lock them in for publishing, or open your visual grid to swap photos/times:`;

          await sendMarketerWhatsApp({
            to: sub.primary_whatsapp_phone,
            body: `☀️ *Monday Strategy Kickoff — ${sub.companies.name}*\n\nI've lined up 3 posts for this week:\n\n${createdLines.join('\n')}\n\n${headerNote}\n📅 Open Calendar Grid: ${calSession.url}`,
          });

          processed.push({ company_id: sub.company_id, outcome: 'sent_monday_kickoff' });
        } catch (err) {
          console.error('[proactive-cron] monday_kickoff error:', sub.company_id, err);
          processed.push({ company_id: sub.company_id, outcome: 'error' });
        }
      }
    }

    // ── JOB 2: FRIDAY ROI WINS DIGEST ─────────────────────────────────────
    if (jobType === 'friday_digest') {
      const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
      for (const sub of subs) {
        if (!sub.companies) continue;
        const [{ count: published7d }, { count: readyVault }] = await Promise.all([
          supabase
            .from('scheduled_posts')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', sub.company_id)
            .eq('status', 'published')
            .gte('updated_at', since7d),
          supabase
            .from('company_media')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', sub.company_id)
            .in('vault_status', ['ready', 'evergreen']),
        ]);

        const vaultNum = readyVault || 0;
        const vaultTip =
          vaultNum < 3
            ? `📸 Your Content Vault only has *${vaultNum}* fresh item(s) left — reply with 3–5 quick photos/clips over the weekend so Monday's plan is ready!`
            : `📁 You have *${vaultNum}* fresh items in your Vault ready for next week.`;

        await sendMarketerWhatsApp({
          to: sub.primary_whatsapp_phone,
          body: `📊 *Friday Wrap-Up — ${sub.companies.name}*\n\n• Posts published this week: *${published7d || 0}*\n• Monthly posts used: *${sub.usage_posts_used}/${sub.monthly_posts_limit}*\n• AI Reels used: *${sub.usage_videos_used}/${sub.monthly_videos_limit}*\n\n${vaultTip}\n\nReply *"audit my page"* anytime to inspect engagement trends!`,
        });
        processed.push({ company_id: sub.company_id, outcome: 'sent_friday_digest' });
      }
    }

    // ── JOB 3: 2-HOUR AUTOPILOT VETO CHECK ────────────────────────────────
    if (jobType === 'autopilot_veto_check') {
      const windowStart = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      const windowEnd = new Date(Date.now() + 150 * 60 * 1000).toISOString();

      for (const sub of subs.filter((s) => s.autopilot_level === 'full_autopilot')) {
        if (!sub.companies) continue;
        const { data: upcoming } = await supabase
          .from('scheduled_posts')
          .select('id, content, target_platform, scheduled_time, image_url, metadata')
          .eq('company_id', sub.company_id)
          .eq('status', 'approved')
          .gte('scheduled_time', windowStart)
          .lte('scheduled_time', windowEnd);

        for (const post of upcoming || []) {
          const meta = (post.metadata && typeof post.metadata === 'object') ? (post.metadata as Record<string, unknown>) : {};
          if (meta.veto_notified) continue;

          await supabase
            .from('scheduled_posts')
            .update({ metadata: { ...meta, veto_notified: true } })
            .eq('id', post.id);

          await sendMarketerWhatsApp({
            to: sub.primary_whatsapp_phone,
            mediaUrls: post.image_url ? [post.image_url] : undefined,
            body: `⏰ *Going live in ~2 hours (${formatLusakaShort(post.scheduled_time)} CAT)* on *${post.target_platform}*:\n\n"${post.content.slice(0, 280)}"\n\nReply *"cancel next post"* or ask me to tweak the caption if you want changes!`,
          });
          processed.push({ company_id: sub.company_id, outcome: `veto_sent:${post.id}` });
        }
      }
    }

    // ── JOB 4: LOW-VAULT & MANUAL RENEWAL CHECK ───────────────────────────
    if (jobType === 'vault_and_renewal_check') {
      const nowMs = Date.now();
      for (const sub of subs) {
        if (!sub.companies) continue;
        const gate = await checkMarketerQuota(supabase, sub, 'chat');
        const subMeta = (sub.metadata && typeof sub.metadata === 'object') ? { ...sub.metadata } : {};
        let touched = false;

        // Renewal reminder at 5 days or 1 day remaining (max 1 reminder per 3 days)
        const daysLeft = Math.ceil((Date.parse(sub.current_period_end) - nowMs) / 86_400_000);
        const lastRenewNudge = typeof subMeta.last_renewal_nudge_at === 'string' ? Date.parse(subMeta.last_renewal_nudge_at) : 0;
        if (gate.allowed && daysLeft <= 5 && daysLeft >= -2 && nowMs - lastRenewNudge > 3 * 86_400_000) {
          await sendMarketerWhatsApp({
            to: sub.primary_whatsapp_phone,
            body: `💳 *Friendly Renewal Reminder — ${sub.companies.name}*\n\nYour monthly Omanut Social Marketer plan (${sub.currency} ${sub.monthly_fee_amount}/mo) ${daysLeft > 0 ? `renews in *${daysLeft} day(s)*` : 'is due for renewal'}.\n\nSend MoMo to your Omanut representative to keep posts & Reels running uninterrupted!`,
          });
          subMeta.last_renewal_nudge_at = new Date().toISOString();
          touched = true;
        }

        // Low-vault nudge (once per 7 days if < 3 ready assets)
        const lastVaultNudge = typeof subMeta.last_vault_nudge_at === 'string' ? Date.parse(subMeta.last_vault_nudge_at) : 0;
        if (gate.allowed && nowMs - lastVaultNudge > 7 * 86_400_000) {
          const { count } = await supabase
            .from('company_media')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', sub.company_id)
            .in('vault_status', ['ready', 'evergreen']);

          if ((count || 0) < 3) {
            const upSession = await createSignedA2UISession(supabase, {
              companyId: sub.company_id,
              phone: sub.primary_whatsapp_phone,
              surfaceType: 'vault_uploader',
            });
            await sendMarketerWhatsApp({
              to: sub.primary_whatsapp_phone,
              body: `📁 *Quick Content Vault Check — ${sub.companies.name}*\n\nYou have *${count || 0}* unused asset(s) waiting in your Vault. Drop 5 photos/clips right here in WhatsApp or bulk-upload from your phone:\n👉 ${upSession.url}`,
            });
            subMeta.last_vault_nudge_at = new Date().toISOString();
            touched = true;
          }
        }

        if (touched) {
          await supabase.from('marketer_subscriptions').update({ metadata: subMeta }).eq('id', sub.id);
        }
        processed.push({ company_id: sub.company_id, outcome: gate.allowed ? 'checked' : 'transitioned_paused' });
      }
    }

    return jsonRes({ ok: true, job_type: jobType, processed });
  } catch (err) {
    console.error('[marketer-proactive-cron] error:', err);
    return jsonRes({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
