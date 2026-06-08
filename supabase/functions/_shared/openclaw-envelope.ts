// Inert stub. OpenClaw was removed; this helper just returns the payload it received
// so existing imports across edge functions keep compiling.

export function buildEnvelope<T = unknown>(payload: T): T {
  return payload;
}
