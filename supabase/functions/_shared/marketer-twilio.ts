export function normalizeDigits(phone: string): string {
  return String(phone || '')
    .replace(/^whatsapp:/i, '')
    .replace(/[^\d]/g, '');
}

export function toTwilioWhatsApp(phone: string): string {
  const digits = normalizeDigits(phone);
  return digits ? `whatsapp:+${digits}` : '';
}

export function getMarketerFromNumber(): string | null {
  const raw = Deno.env.get('MARKETER_WHATSAPP_NUMBER')?.trim() || '+260768737233';
  const formatted = toTwilioWhatsApp(raw);
  return formatted || null;
}

export function cleanWhatsAppFormatting(text: string): string {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkWhatsAppMessage(text: string, maxLen = 1450): string[] {
  const cleaned = cleanWhatsAppFormatting(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  let remaining = cleaned;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let idx = remaining.lastIndexOf('\n\n', maxLen);
    if (idx < maxLen * 0.4) idx = remaining.lastIndexOf('\n', maxLen);
    if (idx < maxLen * 0.4) idx = remaining.lastIndexOf('. ', maxLen);
    if (idx < maxLen * 0.4) idx = remaining.lastIndexOf(' ', maxLen);
    if (idx <= 0) idx = maxLen;
    chunks.push(remaining.slice(0, idx + 1).trim());
    remaining = remaining.slice(idx + 1).trim();
  }
  return chunks.filter(Boolean);
}

async function postTwilioMessage(opts: {
  sid: string;
  token: string;
  from: string;
  to: string;
  body?: string;
  mediaUrl?: string;
}): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.sid}/Messages.json`;
  const form = new URLSearchParams();
  form.append('From', opts.from);
  form.append('To', opts.to);
  if (opts.body) form.append('Body', opts.body);
  if (opts.mediaUrl) form.append('MediaUrl', opts.mediaUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${opts.sid}:${opts.token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const rawText = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Twilio HTTP ${res.status}: ${rawText.slice(0, 300)}` };
  }
  try {
    const parsed = JSON.parse(rawText);
    return { ok: true, sid: parsed.sid };
  } catch {
    return { ok: true };
  }
}

export async function sendMarketerWhatsApp(opts: {
  to: string;
  body?: string;
  mediaUrls?: string[];
  fromOverride?: string | null;
}): Promise<{ ok: boolean; sids: string[]; error?: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = toTwilioWhatsApp(opts.fromOverride || getMarketerFromNumber() || '');
  const to = toTwilioWhatsApp(opts.to);

  if (!sid || !token || !from || !to) {
    return {
      ok: false,
      sids: [],
      error: `Missing Twilio config or phone (hasSid=${!!sid}, hasFrom=${!!from}, hasTo=${!!to})`,
    };
  }

  const sids: string[] = [];
  const urls = Array.isArray(opts.mediaUrls) ? opts.mediaUrls.filter(Boolean).slice(0, 5) : [];
  const chunks = opts.body ? chunkWhatsAppMessage(opts.body) : [];

  try {
    // If we have media, attach caption on the first chunk when concise, otherwise send media + text cleanly
    if (urls.length > 0) {
      if (chunks.length === 1 && chunks[0].length <= 1000 && urls.length === 1) {
        const res = await postTwilioMessage({ sid, token, from, to, body: chunks[0], mediaUrl: urls[0] });
        if (!res.ok) return { ok: false, sids, error: res.error };
        if (res.sid) sids.push(res.sid);
        return { ok: true, sids };
      }

      for (let i = 0; i < urls.length; i++) {
        const res = await postTwilioMessage({
          sid,
          token,
          from,
          to,
          mediaUrl: urls[i],
        });
        if (!res.ok) {
          console.error('[marketer-twilio] media send error:', res.error);
        } else if (res.sid) {
          sids.push(res.sid);
        }
      }
    }

    for (const chunk of chunks) {
      const res = await postTwilioMessage({ sid, token, from, to, body: chunk });
      if (!res.ok) return { ok: false, sids, error: res.error };
      if (res.sid) sids.push(res.sid);
    }

    return { ok: true, sids };
  } catch (err) {
    return { ok: false, sids, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function downloadTwilioMedia(
  mediaUrl: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');

  const headers: Record<string, string> = {};
  if (sid && token && mediaUrl.includes('api.twilio.com')) {
    headers.Authorization = 'Basic ' + btoa(`${sid}:${token}`);
  }

  const res = await fetch(mediaUrl, { headers });
  if (!res.ok) {
    throw new Error(`Failed to download WhatsApp media (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { bytes, contentType };
}
