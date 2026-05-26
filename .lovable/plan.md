## Goal

Confirm the `MINIMAX_API_KEY` already stored in Lovable Cloud is valid for `https://api.minimax.io/v1/text/chatcompletion_v2` with model `MiniMax-M2`. If valid, the local OpenClaw pull loop is failing only because its `.env` holds a different (group-ID or stale) key. We then copy the working key from Lovable Cloud into the local `.env`.

## Steps

1. **Add a diagnostic edge function** `supabase/functions/diag-minimax/index.ts`:
   - GET endpoint, `verify_jwt = false`.
   - Reads `MINIMAX_API_KEY` from env.
   - Calls `POST https://api.minimax.io/v1/text/chatcompletion_v2` with:
     ```json
     { "model": "MiniMax-M2", "max_tokens": 32,
       "messages": [{"role":"user","content":"ping"}] }
     ```
   - Returns JSON: `{ http_status, base_resp, key_prefix: first 8 chars + "…" + last 4, key_length, content_preview }` so we can see exactly what MiniMax says without ever leaking the full key.
   - Includes CORS headers.

2. **Deploy it** with `supabase--deploy_edge_functions(["diag-minimax"])`.

3. **Call it** via `supabase--curl_edge_functions` and read the result:
   - `base_resp.status_code === 0` + a `content_preview` → key is good. Continue to step 4.
   - `status_code === 1004` ("auth error") → the stored Lovable key is *also* wrong/stale. Pivot: prompt you to paste a fresh secret key from `bms.omanut.me`, then `update_secret('MINIMAX_API_KEY')`, redeploy, re-run diag.

4. **Get the working key onto your laptop** (only if step 3 succeeds):
   - Open **Lovable → Project Settings → Secrets → `MINIMAX_API_KEY`** and click *Reveal* / *Copy*.
   - Paste it into your local `openclaw-pull-loop` `.env` as `MINIMAX_API_KEY=...` (no `Bearer ` prefix, raw key only).
   - Restart the loop: `pm2 restart openclaw-pull-loop`.
   - Send a "Hi" to Omanut WhatsApp; verify `inbound_events` flips `pending → processing(claimed_by=openclaw) → completed` in `/admin/sandbox-console`.

5. **Cleanup**: once confirmed, delete `diag-minimax` (it exposes a small surface for anyone with the URL). Done via `supabase--delete_edge_functions(["diag-minimax"])`.

## Technical notes

- Why this is safe: the diagnostic only returns a masked prefix/suffix of the key and the model's reply preview — never the full secret.
- No DB changes, no migration, no Lovable UI changes. One temporary edge function, then removed.
- The endpoint and Bearer-token pattern in `supabase/functions/_shared/gemini-client.ts` (lines 15, 167) are identical to what your pull loop is using, so any difference in result isolates the key value as the variable.

## Out of scope

- The `openclaw-pull-loop` script itself (lives on your laptop, not in this repo).
- Changing the production `_shared/gemini-client.ts` path.
