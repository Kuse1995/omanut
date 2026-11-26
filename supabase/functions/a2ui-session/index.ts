import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { verifyA2UIToken } from '../_shared/a2ui-token.ts';
import { sendMarketerWhatsApp } from '../_shared/marketer-twilio.ts';
import { resolveEffectiveUserId } from '../_shared/marketer-billing.ts';
import {
  buildLinkedInAuthorizeUrl,
  buildTikTokAuthorizeUrl,
  CONNECT_LINK_TTL_MS,
  LINKEDIN_PAGES_SCOPES,
  LINKEDIN_SCOPES,
  randomCodeVerifier,
  signConnectLink,
  signState,
  socialConfig,
  tiktokCodeChallenge,
} from '../_shared/social-oauth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_MEDIA_CATEGORIES = new Set([
  'menu', 'interior', 'exterior', 'logo', 'products', 'promotional', 'staff', 'events', 'facilities', 'other',
]);

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseLusakaTimeToUtcIso(input: string): string {
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

function extFromFileName(name: string, contentType: string): string {
  const fromName = name.split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '');
  if (fromName && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov'].includes(fromName)) {
    return fromName;
  }
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('video')) return 'mp4';
  return 'jpg';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const rawToken = String(body?.token || url.searchParams.get('t') || '').trim();
    const action = req.method === 'GET' ? 'load' : String(body?.action || 'load');

    const verified = await verifyA2UIToken(supabase, rawToken);
    if (!verified.valid) {
      return jsonRes({ error: verified.reason }, 401);
    }

    const { session, companyId, phone } = verified;

    // ── ACTION: load ──────────────────────────────────────────────────────
    if (action === 'load') {
      const [
        companyRes,
        brandKitRes,
        imgSettingsRes,
        subRes,
        vaultRes,
        postsRes,
        genImgsRes,
        vidJobsRes,
        metaCredsRes,
        socialCredsRes,
      ] = await Promise.all([
        supabase.from('companies').select('id, name, business_type, services, hours').eq('id', companyId).single(),
        supabase.from('brand_kits').select('*').eq('company_id', companyId).maybeSingle(),
        supabase.from('image_generation_settings').select('*').eq('company_id', companyId).maybeSingle(),
        supabase.from('marketer_subscriptions').select('*').eq('company_id', companyId).maybeSingle(),
        supabase
          .from('company_media')
          .select('id, file_name, file_path, file_type, media_type, category, description, tags, vault_status, source_channel, quality_score, ai_hook_suggestions, recommended_format, times_posted, last_posted_at, priority_rank, created_at')
          .eq('company_id', companyId)
          .neq('vault_status', 'archived')
          .order('priority_rank', { ascending: true, nullsFirst: false })
          .order('quality_score', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(60),
        supabase
          .from('scheduled_posts')
          .select('id, content, target_platform, scheduled_time, status, image_url, image_urls, video_url, page_id, error_message, metadata, created_at')
          .eq('company_id', companyId)
          .order('scheduled_time', { ascending: true })
          .limit(40),
        supabase
          .from('generated_images')
          .select('id, prompt, image_url, status, created_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('video_generation_jobs')
          .select('id, prompt, video_url, status, aspect_ratio, created_at')
          .eq('company_id', companyId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('meta_credentials')
          .select('id, page_id, page_name, page_picture_url, ig_user_id, health_status, last_verified_at')
          .eq('company_id', companyId),
        supabase
          .from('social_credentials')
          .select('id, platform, account_id, account_name, account_type, token_expires_at')
          .eq('company_id', companyId),
      ]);

      const vault = (vaultRes.data || []).map((item) => {
        const { data: pub } = supabase.storage.from('company-media').getPublicUrl(item.file_path);
        return { ...item, url: pub.publicUrl };
      });

      const metaAppId = Deno.env.get('META_APP_ID') || null;
      const metaConfigId = Deno.env.get('META_CONFIG_ID') || null;
      const metaList = metaCredsRes.data || [];
      const socialList = socialCredsRes.data || [];

      return jsonRes({
        ok: true,
        session: {
          id: session.id,
          surface_type: session.surface_type,
          ui_spec: session.ui_spec,
          status: session.status,
          expires_at: session.expires_at,
        },
        company: companyRes.data,
        brand_kit: brandKitRes.data,
        image_settings: imgSettingsRes.data,
        subscription: subRes.data,
        vault,
        scheduled_posts: postsRes.data || [],
        recent_creatives: {
          images: genImgsRes.data || [],
          videos: vidJobsRes.data || [],
        },
        connections: {
          meta: metaList,
          meta_app_id: metaAppId,
          meta_config_id: metaConfigId,
          tiktok: socialList.find((s) => s.platform === 'tiktok') || null,
          linkedin: socialList.find((s) => s.platform === 'linkedin') || null,
        },
      });
    }

    // ── ACTION: mint_upload_urls ──────────────────────────────────────────
    if (action === 'mint_upload_urls') {
      const files = Array.isArray(body?.files) ? body.files.slice(0, 20) : [];
      if (files.length === 0) return jsonRes({ error: 'files array required' }, 400);

      const results: Array<{ file_name: string; file_path: string; signed_url: string; token: string; public_url: string; media_type: 'image' | 'video' }> = [];
      for (const f of files) {
        const name = String(f?.file_name || 'upload.jpg');
        const contentType = String(f?.content_type || 'image/jpeg');
        const isVideo = contentType.startsWith('video/');
        if (!contentType.startsWith('image/') && !isVideo) {
          continue;
        }
        const ext = extFromFileName(name, contentType);
        const filePath = `vault/${companyId}/${crypto.randomUUID()}.${ext}`;
        const { data: signed, error: signErr } = await supabase.storage
          .from('company-media')
          .createSignedUploadUrl(filePath);
        if (signErr || !signed) {
          console.error('[a2ui-session] createSignedUploadUrl failed:', signErr);
          continue;
        }
        const { data: pub } = supabase.storage.from('company-media').getPublicUrl(filePath);
        results.push({
          file_name: name,
          file_path: filePath,
          signed_url: signed.signedUrl,
          token: signed.token,
          public_url: pub.publicUrl,
          media_type: isVideo ? 'video' : 'image',
        });
      }

      return jsonRes({ ok: true, uploads: results });
    }

    // ── ACTION: complete_vault_upload ─────────────────────────────────────
    if (action === 'complete_vault_upload') {
      const uploads = Array.isArray(body?.uploads) ? body.uploads.slice(0, 20) : [];
      if (uploads.length === 0) return jsonRes({ error: 'uploads array required' }, 400);

      const insertedIds: string[] = [];
      for (const u of uploads) {
        const filePath = String(u?.file_path || '');
        if (!filePath.startsWith(`vault/${companyId}/`)) continue;
        const isVideo = u?.media_type === 'video' || String(u?.file_type || '').startsWith('video/');

        const { data: row, error: insErr } = await supabase
          .from('company_media')
          .insert({
            company_id: companyId,
            file_name: String(u?.file_name || 'asset'),
            file_path: filePath,
            file_size: Number(u?.file_size || 0),
            file_type: String(u?.file_type || (isVideo ? 'video/mp4' : 'image/jpeg')),
            media_type: isVideo ? 'video' : 'image',
            category: 'products',
            description: isVideo ? 'Uploaded video clip via Studio' : 'Uploaded photo via Studio',
            asset_validation_status: 'approved',
            vault_status: 'ready',
            source_channel: 'a2ui_uploader',
          })
          .select('id')
          .single();

        if (!insErr && row) {
          insertedIds.push(row.id);
        }
      }

      // Async AI enrichment + WhatsApp notification
      const enrichTask = (async () => {
        const { data: company } = await supabase.from('companies').select('name, business_type').eq('id', companyId).maybeSingle();
        let topScoreCount = 0;

        for (const id of insertedIds) {
          const { data: m } = await supabase.from('company_media').select('id, file_path, file_name, file_type, media_type').eq('id', id).maybeSingle();
          if (!m || m.media_type !== 'image') continue;
          try {
            const { data: fileBlob } = await supabase.storage.from('company-media').download(m.file_path);
            if (!fileBlob || fileBlob.size > 6 * 1024 * 1024) continue;
            const bytes = new Uint8Array(await fileBlob.arrayBuffer());
            const dataUrl = `data:${m.file_type};base64,${encodeBase64(bytes)}`;

            const anRes = await fetch(`${supabaseUrl}/functions/v1/analyze-media`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageDataUrl: dataUrl,
                fileName: m.file_name,
                fileType: m.file_type,
                businessType: company?.business_type || 'business',
              }),
            });
            if (anRes.ok) {
              const an = await anRes.json();
              const patch: Record<string, unknown> = {};
              if (typeof an.category === 'string' && VALID_MEDIA_CATEGORIES.has(an.category)) patch.category = an.category;
              if (typeof an.description === 'string') patch.description = an.description;
              if (Array.isArray(an.tags)) patch.tags = an.tags.map(String).slice(0, 8);
              if (typeof an.quality_score === 'number') {
                patch.quality_score = an.quality_score;
                if (an.quality_score >= 8) topScoreCount += 1;
              }
              if (typeof an.recommended_format === 'string') patch.recommended_format = an.recommended_format;
              if (Array.isArray(an.ai_hook_suggestions)) patch.ai_hook_suggestions = an.ai_hook_suggestions.map(String).slice(0, 3);
              await supabase.from('company_media').update(patch).eq('id', m.id);
            }
            fetch(`${supabaseUrl}/functions/v1/index-brand-asset`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ media_id: m.id, company_id: companyId }),
            }).catch(() => {});
          } catch (e) {
            console.warn('[a2ui-session] enrich error:', e);
          }
        }

        if (body?.notify_whatsapp !== false && insertedIds.length > 0 && phone) {
          await sendMarketerWhatsApp({
            to: phone,
            body: `📁 *Added ${insertedIds.length} item(s) to ${company?.name || 'your'} Content Vault!*${topScoreCount > 0 ? ` (${topScoreCount} scored 8+/10)` : ''}\n\nWant me to suggest which ones should go first this week? Just reply *"which goes first?"* or tap the Prioritize tab!`,
          });
        }
      })();

      if (typeof (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime !== 'undefined') {
        (globalThis as unknown as { EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime.waitUntil(enrichTask);
      } else {
        await enrichTask;
      }

      return jsonRes({ ok: true, count: insertedIds.length, ids: insertedIds });
    }

    // ── ACTION: update_vault_asset ────────────────────────────────────────
    if (action === 'update_vault_asset') {
      const assetId = String(body?.asset_id || '');
      if (!assetId) return jsonRes({ error: 'asset_id required' }, 400);
      const patch: Record<string, unknown> = {};
      if (typeof body?.vault_status === 'string') patch.vault_status = body.vault_status;
      if (typeof body?.description === 'string') patch.description = body.description;
      if (Array.isArray(body?.tags)) patch.tags = body.tags.map(String);

      const { error } = await supabase
        .from('company_media')
        .update(patch)
        .eq('id', assetId)
        .eq('company_id', companyId);

      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes({ ok: true });
    }

    // ── ACTION: submit_vault_ranking ──────────────────────────────────────
    if (action === 'submit_vault_ranking') {
      const rankedIds: string[] = Array.isArray(body?.ranked_asset_ids) ? body.ranked_asset_ids.map(String) : [];
      const note = typeof body?.note === 'string' ? body.note.trim() : '';
      if (rankedIds.length === 0) return jsonRes({ error: 'Select at least 1 asset to prioritize' }, 400);

      // Clear previous priority ranks then write the new top-N ranks
      await supabase.from('company_media').update({ priority_rank: null }).eq('company_id', companyId);
      for (let i = 0; i < rankedIds.length; i++) {
        await supabase
          .from('company_media')
          .update({ priority_rank: i + 1 })
          .eq('id', rankedIds[i])
          .eq('company_id', companyId);
      }

      const { data: rankedAssets } = await supabase
        .from('company_media')
        .select('id, file_name, file_path, description, quality_score, ai_hook_suggestions, priority_rank')
        .eq('company_id', companyId)
        .in('id', rankedIds);

      await supabase
        .from('a2ui_sessions')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          result_payload: { ranked_asset_ids: rankedIds, note },
        })
        .eq('id', session.id);

      // Trigger agent continuation so owner gets immediate WhatsApp drafts
      fetch(`${supabaseUrl}/functions/v1/whatsapp-marketer-agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          internal_event: 'a2ui_callback',
          company_id: companyId,
          phone,
          event_type: 'vault_ranking_submitted',
          payload: {
            note,
            ranked_assets: (rankedAssets || []).sort((a, b) => (a.priority_rank || 99) - (b.priority_rank || 99)),
          },
        }),
      }).catch((e) => console.error('[a2ui-session] callback invoke error:', e));

      return jsonRes({ ok: true });
    }

    // ── ACTION: update_scheduled_post / approve_week / delete_scheduled_post ──
    if (action === 'update_scheduled_post') {
      const postId = String(body?.post_id || '');
      if (!postId) return jsonRes({ error: 'post_id required' }, 400);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body?.content === 'string') patch.content = body.content;
      if (typeof body?.scheduled_time_lusaka === 'string') patch.scheduled_time = parseLusakaTimeToUtcIso(body.scheduled_time_lusaka);
      if (typeof body?.status === 'string' && ['draft', 'pending_approval', 'approved'].includes(body.status)) patch.status = body.status;
      if (typeof body?.image_url === 'string') {
        patch.image_url = body.image_url;
        patch.image_urls = [body.image_url];
      }

      const { error } = await supabase.from('scheduled_posts').update(patch).eq('id', postId).eq('company_id', companyId);
      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes({ ok: true });
    }

    if (action === 'approve_week') {
      const { data: approved } = await supabase
        .from('scheduled_posts')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .in('status', ['draft', 'pending_approval'])
        .select('id');

      const count = approved?.length || 0;
      if (count > 0 && phone) {
        sendMarketerWhatsApp({
          to: phone,
          body: `✅ Approved *${count}* scheduled post(s)! Your Omanut Marketer will publish each right on time.`,
        }).catch(() => {});
      }
      return jsonRes({ ok: true, approved_count: count });
    }

    if (action === 'delete_scheduled_post') {
      const postId = String(body?.post_id || '');
      if (!postId) return jsonRes({ error: 'post_id required' }, 400);
      const { error } = await supabase.from('scheduled_posts').delete().eq('id', postId).eq('company_id', companyId);
      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes({ ok: true });
    }

    // ── ACTION: creative_action ───────────────────────────────────────────
    if (action === 'creative_action') {
      fetch(`${supabaseUrl}/functions/v1/whatsapp-marketer-agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          internal_event: 'a2ui_callback',
          company_id: companyId,
          phone,
          event_type: 'creative_action',
          payload: {
            mode: body?.mode || 'schedule_now',
            media_url: body?.media_url,
            media_type: body?.media_type || 'image',
            tweak_instruction: body?.tweak_instruction || '',
            caption: body?.caption || '',
          },
        }),
      }).catch((e) => console.error('[a2ui-session] creative_action error:', e));
      return jsonRes({ ok: true });
    }

    // ── ACTION: save_brand_dna ────────────────────────────────────────────
    if (action === 'save_brand_dna') {
      const effectiveUserId = await resolveEffectiveUserId(supabase, companyId);
      const colors = body?.colors && typeof body.colors === 'object' ? body.colors : undefined;

      await supabase.from('brand_kits').upsert({
        company_id: companyId,
        logo_url: typeof body?.logo_url === 'string' ? body.logo_url : undefined,
        colors,
        tone: typeof body?.tone === 'string' ? body.tone : undefined,
        guidelines: typeof body?.guidelines === 'string' ? body.guidelines : undefined,
        no_go_phrases: typeof body?.no_go_phrases === 'string' ? body.no_go_phrases : undefined,
        updated_at: new Date().toISOString(),
        updated_by: effectiveUserId,
      }, { onConflict: 'company_id' });

      await supabase.from('image_generation_settings').upsert({
        company_id: companyId,
        enabled: true,
        brand_tone: typeof body?.tone === 'string' ? body.tone : undefined,
        brand_colors: colors,
        style_description: typeof body?.style_description === 'string' ? body.style_description : undefined,
        visual_guidelines: typeof body?.guidelines === 'string' ? body.guidelines : undefined,
      }, { onConflict: 'company_id' });

      if (typeof body?.autopilot_level === 'string' && ['copilot', 'weekly_batch', 'full_autopilot'].includes(body.autopilot_level)) {
        await supabase
          .from('marketer_subscriptions')
          .update({ autopilot_level: body.autopilot_level })
          .eq('company_id', companyId);
      }

      if (phone) {
        sendMarketerWhatsApp({
          to: phone,
          body: `🎨 Updated your *Brand DNA* and creative preferences! Every new graphic, Reel, and caption will follow these guardrails automatically.`,
        }).catch(() => {});
      }

      return jsonRes({ ok: true });
    }

    // ── ACTION: start_social_connect (TikTok / LinkedIn zero-login OAuth) ──
    if (action === 'start_social_connect') {
      const rawPlatform = String(body?.platform || '');
      if (rawPlatform !== 'tiktok' && rawPlatform !== 'linkedin' && rawPlatform !== 'linkedin_pages') {
        return jsonRes({ error: 'Unsupported platform' }, 400);
      }

      const cfg = socialConfig();
      if (!cfg.stateSecret) {
        return jsonRes({ error: 'Social sign-in secret is not configured' }, 500);
      }
      const isLinkedInPages = rawPlatform === 'linkedin_pages';
      const dbPlatform = isLinkedInPages ? 'linkedin' : (rawPlatform as 'linkedin' | 'tiktok');
      const mode = isLinkedInPages ? ('organization' as const) : undefined;

      const redirectUri = isLinkedInPages
        ? cfg.linkedinPages.redirectUri
        : rawPlatform === 'linkedin'
        ? cfg.linkedin.redirectUri
        : cfg.tiktok.redirectUri;

      const verifier = dbPlatform === 'tiktok' ? randomCodeVerifier() : null;
      const expiresAt = Date.now() + CONNECT_LINK_TTL_MS;
      const { data: oauthRow, error: oauthErr } = await supabase
        .from('social_oauth_sessions')
        .insert({
          company_id: companyId,
          platform: dbPlatform,
          kind: 'link',
          code_verifier: verifier,
          redirect_uri: redirectUri,
          expires_at: new Date(expiresAt).toISOString(),
        })
        .select('id')
        .single();

      if (oauthErr || !oauthRow) {
        return jsonRes({ error: oauthErr?.message || 'Failed to start OAuth session' }, 500);
      }

      const state = await signState({
        n: oauthRow.id,
        c: companyId,
        p: dbPlatform,
        u: 'link',
        exp: expiresAt,
        ...(mode ? { m: mode } : {}),
      }, cfg.stateSecret);

      // Keep link token available for traceability, though direct authorize_url already works 1-tap
      await signConnectLink({ k: 'link', n: oauthRow.id, c: companyId, p: dbPlatform, exp: expiresAt, ...(mode ? { m: mode } : {}) }, cfg.stateSecret);

      const authorizeUrl = isLinkedInPages
        ? buildLinkedInAuthorizeUrl(cfg.linkedinPages.clientId, redirectUri, state, LINKEDIN_PAGES_SCOPES)
        : rawPlatform === 'linkedin'
        ? buildLinkedInAuthorizeUrl(cfg.linkedin.clientId, redirectUri, state, LINKEDIN_SCOPES)
        : buildTikTokAuthorizeUrl(cfg.tiktok.clientKey, redirectUri, state, await tiktokCodeChallenge(verifier!));

      return jsonRes({ ok: true, authorize_url: authorizeUrl });
    }

    return jsonRes({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('[a2ui-session] error:', err);
    return jsonRes({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
