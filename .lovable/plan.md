

User wants to harden the BMS integration end-to-end. Let me think about what's actually weak today based on what I know from the codebase + memory.

**Known weak spots from memory + earlier turns:**
1. `bms-agent` retries auth header but doesn't retry transient 5xx / network errors
2. `bms_generate_payment_link` returning Unauthorized (RBAC) — no diagnostic path, customer just sees a generic failure
3. 8s timeout on BMS tool calls triggers a streaming ack but no retry/circuit-breaker — repeated timeouts hammer a slow BMS
4. `loadBmsConnection` has no caching — every WhatsApp message hits the DB to re-fetch the connection row
5. No structured error taxonomy — `ai_error_logs` gets free-text BMS errors, hard to spot patterns
6. AI sometimes invents product/stock numbers because BMS failures fall back to KB silently (violates `bms-data-priority-messaging` memory)
7. No health-check pings — first sign of BMS being down is a customer-facing failure
8. `ACTION_ALIASES` map is good but not surfaced to the AI — AI keeps using legacy names that get translated, masking spec drift
9. No idempotency on writes (`record_sale`, `create_invoice`) — a retry on timeout could double-charge
10. No per-company rate limit — a runaway loop could DoS the BMS bridge

User said "in all aspects" — they want a real plan, not a one-line patch. Six tracks, ranked by impact. Keep it under 10K chars.

I won't ask clarifying questions — the request is broad on purpose, and the plan presents the menu so the user can pick.

