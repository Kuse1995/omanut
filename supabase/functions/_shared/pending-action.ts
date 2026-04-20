// Detect when a user's short affirmation ("yes", "sure", "ok", "👍") refers
// to a pending offer made by the assistant in the immediately preceding turn.
//
// Used by whatsapp-messages (and reusable by bms-agent / boss-chat / meta-webhook)
// to give the AI conversational context awareness — so customers can reply "yes"
// to "Want me to send a picture?" without re-stating the verb+keyword.

export type PendingActionType =
  | 'media'        // assistant offered to send a picture/photo/video
  | 'reservation'  // assistant offered to make a booking/reservation
  | 'handoff'      // assistant offered to notify boss / connect human / hold item
  | 'pricelist'    // assistant offered to share price list / catalog
  | 'order'        // assistant offered to place / record an order
  | null;

export interface PendingAction {
  type: PendingActionType;
  /** The text of the assistant message that contains the offer */
  offerText: string;
  /** Best-effort extraction of the subject (e.g. product name) the offer was about */
  subject: string | null;
}

const AFFIRMATION_RE =
  /^(yes+|yea+h?|yep+|ya+|yup|sure|ok+|okay|please+|pls|yes\s+please|go\s+ahead|do\s+it|sounds\s+good|great|perfect|👍|✅|🙏|👌|✔️?|of\s+course|absolutely|definitely)\b[!.\s👍✅🙏👌✔️]*$/i;

const NEGATION_RE =
  /^(no+|nope|nah|not\s+now|maybe\s+later|don'?t|cancel|stop)\b/i;

const MEDIA_OFFER_RE =
  /\b(show|see|send|share|view|attach|drop|forward)\b[\s\S]{0,40}\b(picture|pictures|photo|photos|image|images|pic|pics|video|videos|catalog\s+image|gallery)\b/i;

const RESERVATION_OFFER_RE =
  /\b(reserve|book|schedule|set\s+up|hold)\b[\s\S]{0,40}\b(table|spot|appointment|booking|reservation|seat|slot)\b/i;

const HANDOFF_OFFER_RE =
  /\b(notify|alert|tell|inform|connect|forward|escalate|hand\s+over)\b[\s\S]{0,40}\b(boss|owner|manager|team|human|agent|someone)\b|\bget\s+(the\s+)?(boss|owner|manager|team)\b|\bhold\s+(one|it|this|that)\b/i;

const PRICELIST_OFFER_RE =
  /\b(send|share|show|view)\b[\s\S]{0,30}\b(price\s+list|pricelist|catalog|menu|brochure|full\s+list)\b/i;

const ORDER_OFFER_RE =
  /\b(place|record|create|start|process)\b[\s\S]{0,30}\b(order|sale|purchase|checkout)\b|\bwant\s+to\s+(buy|order|purchase)\b\s*\?/i;

/**
 * True if the user message is a bare affirmation (yes/sure/ok/👍 etc.) with
 * no additional substantive content.
 */
export function isShortAffirmation(message: string): boolean {
  if (!message) return false;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 30) return false;
  if (NEGATION_RE.test(trimmed)) return false;
  return AFFIRMATION_RE.test(trimmed);
}

/**
 * Best-effort: pull a subject phrase out of the assistant's offer (e.g.
 * "Want to see a picture of the cake stand?" -> "the cake stand").
 */
function extractSubject(offerText: string): string | null {
  const m =
    offerText.match(/\bof\s+(?:the\s+|a\s+|an\s+|our\s+|some\s+)?([a-z0-9][\w\s\-']{2,40}?)(?=[.?!,]|\s+(?:so|that|which|to|for|now)\b|$)/i) ||
    offerText.match(/\bfor\s+(?:the\s+|a\s+|an\s+|our\s+)?([a-z0-9][\w\s\-']{2,40}?)(?=[.?!,]|$)/i);
  if (!m) return null;
  return m[1].trim().replace(/[.?!,]+$/, '');
}

/**
 * Inspect the most recent assistant message and classify what kind of action
 * (if any) the assistant is currently waiting for the customer to confirm.
 */
export function detectPendingActionFromAssistant(
  lastAssistantMessage: string | null | undefined
): PendingAction | null {
  if (!lastAssistantMessage) return null;
  const text = lastAssistantMessage.trim();
  if (!text) return null;

  // Order matters — most specific first.
  if (MEDIA_OFFER_RE.test(text)) {
    return { type: 'media', offerText: text, subject: extractSubject(text) };
  }
  if (RESERVATION_OFFER_RE.test(text)) {
    return { type: 'reservation', offerText: text, subject: extractSubject(text) };
  }
  if (PRICELIST_OFFER_RE.test(text)) {
    return { type: 'pricelist', offerText: text, subject: extractSubject(text) };
  }
  if (HANDOFF_OFFER_RE.test(text)) {
    return { type: 'handoff', offerText: text, subject: extractSubject(text) };
  }
  if (ORDER_OFFER_RE.test(text)) {
    return { type: 'order', offerText: text, subject: extractSubject(text) };
  }
  // Generic "?" with strong action verb still counts as a soft pending offer
  if (/\?\s*$/.test(text) && /\b(want|would\s+you\s+like|shall\s+i|should\s+i|do\s+you\s+want|can\s+i)\b/i.test(text)) {
    return { type: null, offerText: text, subject: extractSubject(text) };
  }
  return null;
}

/**
 * Combined helper: given conversation history (chronological, role+content)
 * and the current user message, return a PendingAction if and only if the
 * user is affirming an offer the assistant just made.
 */
export function detectPendingAction(
  conversationHistory: Array<{ role: string; content: string }>,
  currentUserMessage: string
): PendingAction | null {
  if (!isShortAffirmation(currentUserMessage)) return null;
  // Walk back to find the LAST assistant turn (not the last message — there
  // could be tool/system messages between)
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const m = conversationHistory[i];
    if (m.role === 'assistant' && m.content) {
      return detectPendingActionFromAssistant(m.content);
    }
    if (m.role === 'user') {
      // If the most recent user turn (other than the current one) was already
      // a substantive question, treat the current "yes" as standalone.
      // We still allow shallow back-tracking: only stop if we encounter a
      // non-affirmation user message before any assistant turn.
      if (!isShortAffirmation(m.content)) return null;
    }
  }
  return null;
}

/**
 * Render a short instruction string the agent can be primed with so it
 * fulfills the affirmed offer instead of asking "yes to what?".
 */
export function describePendingActionForAgent(action: PendingAction): string {
  const subj = action.subject ? ` (${action.subject})` : '';
  switch (action.type) {
    case 'media':
      return `[CONTEXT] The customer is replying "yes" to your previous offer to send pictures${subj}. Use the list_media / send_media tools now and actually send the image. Do NOT ask them to repeat the request.`;
    case 'reservation':
      return `[CONTEXT] The customer is replying "yes" to your previous offer to make a reservation${subj}. Begin the reservation flow (collect missing details, then create_reservation).`;
    case 'pricelist':
      return `[CONTEXT] The customer is replying "yes" to your previous offer to share the price list${subj}. Send the catalog / pricing information now.`;
    case 'handoff':
      return `[CONTEXT] The customer is replying "yes" to your previous offer to notify the team / hold an item${subj}. Call notify_boss now and acknowledge to the customer.`;
    case 'order':
      return `[CONTEXT] The customer is replying "yes" to your previous offer to place an order${subj}. Continue the checkout flow.`;
    default:
      return `[CONTEXT] The customer is affirming your previous question: "${action.offerText.substring(0, 160)}". Act on that offer now — do NOT ask them to clarify.`;
  }
}
