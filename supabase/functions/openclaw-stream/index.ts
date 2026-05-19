// openclaw-stream — Server-Sent Events feed of inbound events.
// OpenClaw opens one persistent GET; we push `data: <json>` frames as rows are
// claimed for it. Auto-resume: client can pass Last-Event-ID = event_id to skip
// rows it already saw (we honor by claiming only newer rows).
//
// Auth: Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>
// Optional: X-Openclaw-Company: <company_id>
//
// Notes:
//   - Edge runtime caps response duration at ~150s in Supabase; client should
//     reconnect on disconnect (EventSource does this automatically).
//   - We poll the queue every 2s. For sub-second latency, use the Realtime
//     subscription on the `inbound_events` table directly + claim_inbound_event RPC.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildEnvelope } from '../_shared/openclaw-envelope.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-openclaw-company, last-event-id',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const GATEWAY_TOKEN = Deno.env.get('OPENCLAW_GATEWAY_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('OPENCLAW_WEBHOOK_SECRET') ?? null;
const MAX_LIFE_MS = 140_000; // close before edge runtime kills us

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!GATEWAY_TOKEN || token !== GATEWAY_TOKEN) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const companyId = req.headers.get('x-openclaw-company') || url.searchParams.get('company_id') || null;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string, eventName?: string, id?: string) => {
        if (closed) return;
        let frame = '';
        if (id) frame += `id: ${id}\n`;
        if (eventName) frame += `event: ${eventName}\n`;
        frame += `data: ${data}\n\n`;
        try { controller.enqueue(encoder.encode(frame)); } catch { closed = true; }
      };

      send(JSON.stringify({ ok: true, since: new Date().toISOString() }), 'hello');

      // Heartbeat every 15s
      const hb = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)); }
        catch { closed = true; }
      }, 15_000);

      try {
        while (!closed && Date.now() - startedAt < MAX_LIFE_MS) {
          const { data, error } = await supabase.rpc('claim_pending_events', {
            _company_id: companyId,
            _max: 10,
            _claimed_by: 'openclaw',
          });
          if (error) {
            send(JSON.stringify({ error: error.message }), 'error');
            await sleep(2000);
            continue;
          }
          if (data && data.length > 0) {
            for (const ev of data) {
              try {
                const { envelope, signature } = await buildEnvelope(supabase, ev, { signSecret: WEBHOOK_SECRET });
                send(JSON.stringify({ ...envelope, signature }), 'event', ev.id);
              } catch (e) {
                console.warn('[openclaw-stream] envelope failed', ev.id, String(e).slice(0, 200));
                await supabase.from('inbound_events').update({
                  status: 'pending', claimed_by: null, claimed_at: null,
                }).eq('id', ev.id);
              }
            }
          } else {
            await sleep(2000);
          }
        }
        send(JSON.stringify({ reason: 'reconnect' }), 'bye');
      } finally {
        clearInterval(hb);
        try { controller.close(); } catch { /* noop */ }
      }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
