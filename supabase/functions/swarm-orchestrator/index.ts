// Omanut Social Swarm — Orchestrator edge function.
// Sync mode: returns refined text to caller.
// post_hoc_refine mode: caller already sent a draft; we run swarm in background and
// only emit a follow-up correction if the refined text materially diverges.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runSwarm } from '../_shared/swarm/overseer.ts';
import type { SwarmInput, SwarmMode } from '../_shared/swarm/types.ts';
import { DEFAULT_PROFILE } from '../_shared/swarm/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Cheap text similarity (token Jaccard). 0 = identical, 1 = totally different. */
function divergence(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const mode: SwarmMode = body.mode === 'post_hoc_refine' ? 'post_hoc_refine' : 'sync';
  const channel = body.channel || 'whatsapp';
  const input: SwarmInput = {
    company_id: String(body.company_id || ''),
    channel,
    raw_text: String(body.raw_text || body.input || ''),
    conversation_id: body.conversation_id || undefined,
    customer_name: body.customer_name || undefined,
    history: Array.isArray(body.history) ? body.history : [],
    profile: body.profile || DEFAULT_PROFILE[channel as keyof typeof DEFAULT_PROFILE],
    mode,
    already_sent_text: body.already_sent_text || undefined,
    extra_context: body.extra_context || {},
  };

  if (!input.company_id || !input.raw_text) {
    return new Response(JSON.stringify({ error: 'company_id and raw_text are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const t0 = Date.now();
  const result = await runSwarm(supabase, input);
  const total_ms = Date.now() - t0;

  // Divergence + optional follow-up send for post_hoc_refine
  let divergence_score: number | null = null;
  let follow_up_sent = false;
  if (mode === 'post_hoc_refine' && input.already_sent_text && result.final_text) {
    const d = divergence(input.already_sent_text, result.final_text);
    divergence_score = Math.round(d * 100);
    const hardViolation = result.critique_history?.some(c => (c.violations?.length ?? 0) > 0 && c.score < 5);
    const materiallyDifferent = (result.final_score ?? 0) >= 8
      && ((result.final_score ?? 0) - 0 >= 8) // refined draft itself is good
      && (d > 0.55 || hardViolation);

    if (materiallyDifferent && channel === 'whatsapp' && input.conversation_id) {
      try {
        const { data: conv } = await supabase
          .from('conversations')
          .select('phone, company_id')
          .eq('id', input.conversation_id)
          .maybeSingle();
        if (conv?.phone) {
          await supabase.functions.invoke('send-whatsapp', {
            body: {
              company_id: input.company_id,
              to: conv.phone,
              message: `Quick correction: ${result.final_text}`,
            },
          });
          follow_up_sent = true;
        }
      } catch (e) {
        console.warn('[swarm-orchestrator] follow-up send failed:', e);
      }
    }
  }

  // Audit log
  try {
    await supabase.from('swarm_runs').insert({
      company_id: input.company_id,
      channel: input.channel,
      conversation_id: input.conversation_id || null,
      input_excerpt: input.raw_text.slice(0, 500),
      final_text: result.final_text,
      final_score: result.final_score,
      retries: result.retries,
      escalated: result.escalated,
      stage_timings: { ...result.stage_timings, total_ms },
      critique_history: result.critique_history,
      models_used: result.models_used,
      error: result.error || null,
      profile: result.profile,
      bypass_reason: result.bypass_reason,
      bms_cache_hit: result.bms_cache_hit ?? null,
      divergence_score,
      mode,
    });
  } catch (e) {
    console.warn('[swarm-orchestrator] failed to write audit row:', e);
  }

  return new Response(JSON.stringify({ ok: result.ok, ...result, total_ms, divergence_score, follow_up_sent }), {
    status: result.ok ? 200 : 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
