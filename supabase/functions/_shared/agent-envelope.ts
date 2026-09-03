// Agent envelope passthrough. The old OpenClaw pull protocol was removed;
// this helper keeps existing imports compiling and simply returns the
// payload it received (mcp-server enriches envelopes itself).
export function buildEnvelope<T = unknown>(payload: T): T {
  return payload;
}