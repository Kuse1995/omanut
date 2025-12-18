import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Handle Facebook verification handshake (GET request)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    console.log('Facebook verification request received:', { mode, token: token ? '[REDACTED]' : null, challenge });

    const verifyToken = Deno.env.get('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Verification successful, returning challenge');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    } else {
      console.error('Verification failed: token mismatch or invalid mode');
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  // For now, return method not allowed for other requests
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });
});
