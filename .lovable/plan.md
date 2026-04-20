
## ANZ Training Audit — fix config, switch to GLM 4.7

The KB and prompts are fine. Don't wipe them. The issues are 3 config bugs in `company_ai_overrides`. Switching the primary model to **GLM 4.7** (better tool-calling discipline + cheaper than GPT-5, strong instruction following) plus tightening temperature and tokens should solve the rambling, leaked tags, and hallucinated payment links.

### What's wrong

1. **Model + temp combo** — `gemini-2.5-flash` @ `temperature 0.9` is causing word salad and `</think>` leaks.
2. **Hallucinated tools** — AI promises payment links it doesn't have (because Flash @ 0.9 won't obey the prompt).
3. **Over-eager handoff** — `notify_boss` fires on product questions ("what about 25cm?"), not just buy intent.

### Fix (one UPDATE on `company_ai_overrides` for ANZ)

| Setting | Current | Change to | Why |
|---|---|---|---|
| `primary_model` | `google/gemini-2.5-flash` | `zai/glm-4.7` | Strong tool-calling discipline, follows prompts tightly, lower cost than GPT-5 |
| `primary_temperature` | `0.9` | `0.4` | Sales bot needs consistency, not creativity |
| `max_tokens` | `1024` | `400` | Forces concise replies, kills the rambling |
| `response_length` | `medium` | `short` | Reinforces brevity |

Plus append to `system_instructions`:

> "A product question (e.g. 'do you have X?', 'how much is Y?', 'what about 25cm?') is NOT buy intent. Answer it normally with `check_stock`. Only call `notify_boss` when the customer says they want to buy, take, order, reserve, or pay for a SPECIFIC item."

### Pre-flight check

Before applying, verify `zai/glm-4.7` is a valid model identifier in the Lovable AI gateway and is selectable in the AI Deep Settings panel. If not, fall back to `openai/gpt-5-mini` (closest equivalent: disciplined, mid-cost, strong tool use).

### Files

- One `UPDATE` on `company_ai_overrides` where `company_id = ANZ`. No code, no KB changes, no retraining.
- If `glm-4.7` isn't in the model picker dropdown yet, also add it to `AVAILABLE_MODELS.primary` in `src/components/admin/deep-settings/ModelConfigPanel.tsx` so admins can see/change it via UI.

### Verification

1. ANZ AI Deep Settings shows model = GLM 4.7, temp = 0.4, max_tokens = 400.
2. WhatsApp ANZ: *"do you have a cake stand?"* → answers price + offers photo, **no escalation**.
3. WhatsApp: *"I'll take the cake stand"* → calls `notify_boss`, replies "Perfect choice! I'll get the owner to confirm…" and stops.
4. Next 5 conversations: no `</think>` leaks, no fake payment links, replies under 3 sentences.
5. If any rambling persists after 24h, escalate to `gpt-5-mini`.
