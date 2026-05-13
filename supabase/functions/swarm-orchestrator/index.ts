// Omanut Social Swarm — Orchestrator edge function.
// Single entry point. Gated per-company via companies.metadata.swarm_enabled.
// Runs Gatekeeper → Librarian → Creative ↔ Critic loop and returns the final text.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runSwarm } from '../_shared/swarm/overseer.ts';
import type { SwarmInput } from '../_shared/swarm/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
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

  const input: SwarmInput = {
    company_id: String(body.company_id || ''),
    channel: body.channel || 'whatsapp',
    raw_text: String(body.raw_text || body.input || ''),
    conversation_id: body.conversation_id || undefined,
    customer_name: body.customer_name || undefined,
    history: Array.isArray(body.history) ? body.history : [],
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
    });
  } catch (e) {
    console.warn('[swarm-orchestrator] failed to write audit row:', e);
  }

  return new Response(JSON.stringify({ ok: result.ok, ...result, total_ms }), {
    status: result.ok ? 200 : 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
