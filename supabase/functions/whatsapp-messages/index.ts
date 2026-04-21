import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.21.4/mod.ts';
import { geminiChat, geminiChatWithFallback } from "../_shared/gemini-client.ts";
import { embedQuery } from "../_shared/embedding-client.ts";
import {
  detectPendingAction,
  describePendingActionForAgent,
  isShortAffirmation,
  type PendingAction,
} from "../_shared/pending-action.ts";

/** Filter out messages with null/undefined/empty content to prevent 400/404 Gemini errors.
 *  Preserves assistant messages with tool_calls even if content is null (required by API). */
function sanitizeMessages(msgs: Array<{ role: string; content: any; tool_calls?: any[] }>): Array<{ role: string; content: any; tool_calls?: any[] }> {
  return msgs.filter(m => {
    // Keep assistant messages that have tool_calls even if content is empty
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) return true;
    // Keep tool role messages (responses to tool calls)
    if (m.role === 'tool') return true;
    return m.content != null && m.content !== '' && String(m.content) !== 'undefined';
  });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Shared WhatsApp number normalization ──
function normalizeWhatsAppTo(phone: string): string {
  const clean = phone.replace(/^whatsapp:/, '');
  return clean.startsWith('+') ? `whatsapp:${clean}` : `whatsapp:+${clean}`;
}
function normalizeWhatsAppFrom(phone: string): string {
  return phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
}

// ── Shared media URL signing ──
async function signMediaUrls(rawUrls: string[], supabase: any): Promise<string[]> {
  const signed: string[] = [];
  for (const mediaUrl of rawUrls) {
    if (mediaUrl.includes('/company-media/')) {
      const urlParts = mediaUrl.split('/company-media/');
      if (urlParts.length === 2) {
        const filePath = decodeURIComponent(urlParts[1]);
        const { data: signedData } = await supabase.storage
          .from('company-media')
          .createSignedUrl(filePath, 3600);
        if (signedData?.signedUrl) {
          signed.push(signedData.signedUrl);
        } else {
          console.error(`[SIGN] Failed to sign: ${filePath}`);
        }
      }
    } else if (mediaUrl.startsWith('http')) {
      // External URL – pass through
      signed.push(mediaUrl);
    }
  }
  return signed;
}

// ── Shared media library recovery (vector → text → recent) ──
async function recoverMediaFromLibrary(
  query: string,
  companyId: string,
  company: any,
  limit: number,
  supabase: any
): Promise<string[]> {
  let urls: string[] = [];
  // 1. Vector search
  try {
    const expandedQuery = normalizeSearchQuery(query, company);
    const queryVec = await embedQuery(expandedQuery);
    const vectorStr = `[${queryVec.join(',')}]`;
    const { data: mediaResults, error: mediaErr } = await supabase.rpc('match_media', {
      query_embedding: vectorStr,
      match_company_id: companyId,
      match_threshold: 0.25,
      match_count: limit,
    });
    if (!mediaErr && mediaResults?.length) {
      urls = mediaResults.map((m: any) =>
        `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`
      );
      console.log(`[RECOVER] Vector search found ${urls.length} results`);
    }
  } catch (e) { console.error('[RECOVER] Vector search failed:', e); }

  // 2. Text fallback
  if (urls.length === 0) {
    const terms = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
    if (terms.length > 0) {
      const ilikeClauses = terms.map((t: string) => `file_name.ilike.%${t}%,description.ilike.%${t}%`).join(',');
      const { data: textResults } = await supabase
        .from('company_media').select('file_path')
        .eq('company_id', companyId).or(ilikeClauses).limit(limit);
      if (textResults?.length) {
        urls = textResults.map((m: any) =>
          `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`
        );
        console.log(`[RECOVER] Text search found ${urls.length} results`);
      }
    }
  }

  // 3. Recent media fallback
  if (urls.length === 0) {
    const { data: anyMedia } = await supabase
      .from('company_media').select('file_path')
      .eq('company_id', companyId).eq('media_type', 'image')
      .order('created_at', { ascending: false }).limit(limit);
    if (anyMedia?.length) {
      urls = anyMedia.map((m: any) =>
        `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`
      );
      console.log(`[RECOVER] Recent media fallback returned ${urls.length}`);
    }
  }
  return urls;
}

// ── Validate URLs belong to allowed domains ──
function findInvalidUrls(urls: string[]): string[] {
  const allowedDomains = ['supabase.co'];
  return urls.filter((url: string) => {
    try { return !allowedDomains.some(d => new URL(url).hostname.includes(d)); }
    catch { return true; }
  });
}

// ── Shared Twilio media dispatch ──
async function dispatchMediaToWhatsApp(opts: {
  mediaUrls: string[];
  caption?: string;
  category?: string;
  toPhone: string;
  fromNumber: string;
  companyId: string;
  conversationId: string;
  supabase: any;
}): Promise<{ success: boolean; sent: number; total: number; message: string }> {
  const { mediaUrls, caption, category, toPhone, fromNumber, companyId, conversationId, supabase } = opts;
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !fromNumber) {
    return { success: false, sent: 0, total: mediaUrls.length, message: 'Media sending not configured.' };
  }

  const signedUrls = await signMediaUrls(mediaUrls, supabase);
  if (signedUrls.length === 0) {
    return { success: false, sent: 0, total: mediaUrls.length, message: 'Could not sign any media URLs.' };
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const from = normalizeWhatsAppFrom(fromNumber);
  const to = normalizeWhatsAppTo(toPhone);
  const statusCallbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-status-webhook`;

  let successCount = 0;
  for (let i = 0; i < signedUrls.length; i++) {
    const formData = new URLSearchParams();
    formData.append('From', from);
    formData.append('To', to);
    formData.append('Body', i === 0 && caption ? caption : '');
    formData.append('MediaUrl', signedUrls[i]);
    formData.append('StatusCallback', statusCallbackUrl);

    const resp = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (resp.ok) {
      successCount++;
      const data = await resp.json();
      try {
        await supabase.from('media_delivery_status').insert({
          company_id: companyId,
          conversation_id: conversationId,
          customer_phone: toPhone,
          media_url: mediaUrls[i] || signedUrls[i],
          twilio_message_sid: data.sid,
          status: 'queued',
          max_retries: 3,
        });
      } catch (_t) { /* silent */ }
    } else {
      const errBody = await resp.text();
      console.error(`[DISPATCH] Twilio error media ${i + 1}/${signedUrls.length}: ${resp.status} ${errBody}`);
    }
  }

  // Only record "[Sent ...]" marker if at least one succeeded
  if (successCount > 0) {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: `[Sent ${successCount}/${signedUrls.length} ${category || 'media'} file(s)]${caption ? ' - ' + caption : ''}`
    });
  }

  return successCount > 0
    ? { success: true, sent: successCount, total: signedUrls.length, message: `Sent ${successCount} media file(s).` }
    : { success: false, sent: 0, total: signedUrls.length, message: 'All media sends failed.' };
}

// ── Unified send_media handler (validates, auto-recovers, dispatches) ──
async function handleSendMedia(
  args: { media_urls: string[]; caption?: string; category?: string },
  company: any,
  customerPhone: string,
  conversationId: string,
  supabase: any
): Promise<{ result: any; textReply?: string }> {
  const invalid = findInvalidUrls(args.media_urls || []);
  let urls = args.media_urls || [];

  if (invalid.length > 0) {
    console.warn('[SEND-MEDIA] Invalid URLs detected, auto-recovering:', invalid);
    const recoveryQuery = args.caption || args.category || 'product';
    const recovered = await recoverMediaFromLibrary(recoveryQuery, company.id, company, urls.length || 5, supabase);
    if (recovered.length > 0) {
      urls = recovered;
      console.log(`[SEND-MEDIA] Replaced ${invalid.length} bad URLs with ${recovered.length} real ones`);
    } else {
      return {
        result: { success: false, sent: 0, total: 0, message: 'No matching media found in library.' },
        textReply: "I tried to find matching media in our library but couldn't find anything right now. Let me know what you'd like to see and I'll search again."
      };
    }
  }

  const dispatchResult = await dispatchMediaToWhatsApp({
    mediaUrls: urls,
    caption: args.caption,
    category: args.category,
    toPhone: customerPhone,
    fromNumber: company.whatsapp_number,
    companyId: company.id,
    conversationId,
    supabase,
  });

  return { result: dispatchResult };
}

// ── Lightweight Query Expansion for Semantic Search ──
const SLANG_MAP: Record<string, string> = {
  'u': 'you', 'ur': 'your', 'r': 'are', 'thx': 'thanks', 'thnx': 'thanks',
  'pls': 'please', 'plz': 'please', 'msg': 'message', 'pics': 'pictures',
  'pic': 'picture', 'info': 'information', 'abt': 'about', 'govt': 'government',
  'qty': 'quantity', 'amt': 'amount', 'diff': 'different', 'sm': 'small',
  'lg': 'large', 'lrg': 'large', 'med': 'medium', 'yr': 'year',
  'tmrw': 'tomorrow', 'yday': 'yesterday', 'asap': 'as soon as possible',
  'idk': 'I do not know', 'btw': 'by the way', 'nvm': 'never mind',
};

function normalizeSearchQuery(query: string, company: any): string {
  // 1. Strip emojis
  let cleaned = query.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu, '').trim();

  // 2. Expand slang (word-boundary safe)
  cleaned = cleaned.split(/\s+/).map(w => {
    const lower = w.toLowerCase().replace(/[?.!,]+$/, '');
    const suffix = w.slice(lower.length);
    return (SLANG_MAP[lower] || w) + suffix;
  }).join(' ');

  // 3. Normalize common shopping phrases
  cleaned = cleaned.replace(/how much/gi, 'price cost');
  cleaned = cleaned.replace(/got any/gi, 'available products');
  cleaned = cleaned.replace(/what do you (have|sell|offer)/gi, 'available products catalog');

  // 4. Context enrichment for short queries (< 4 words)
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    const context = company?.services || company?.business_type || '';
    if (context) {
      cleaned = `${context} ${cleaned}`;
    }
  }

  console.log(`[QUERY-EXPAND] "${query}" → "${cleaned}"`);
  return cleaned;
}

// Message complexity classifier
function classifyMessageComplexity(message: string): 'simple' | 'complex' {
  const simpleTriggers = [
    /^(hi|hello|hey|good morning|good afternoon|good evening|how are you)/i,
    /^(yes|no|yeah|yep|nope|ok|okay|sure|thanks|thank you|alright)/i,
    /how much|price|cost|hours|location|address|phone|email/i,
    /^what (is|are) (your|the)/i,
    /^(can i|do you|are you)/i,
    /what.*payment|payment.*method|cash only|how.*pay|accept.*payment/i,
    /what.*invoice|what.*receipt|what.*quotation/i,
  ];
  
  const complexTriggers = [
    /book|reserve|reservation|appointment|schedule/i,
    /make.*payment|pay for|process.*payment|pay.*order|pay.*bill/i,
    /generate.*invoice|create.*quotation|create.*estimate|create.*proforma/i,
    /complain|problem|issue|wrong|disappointed|unhappy|frustrated/i,
    /urgent|asap|immediately|emergency/i,
    /cancel.*order|track.*order|return.*order/i,
    /expense|payable|receivable/i,
  ];
  
  const lowerMsg = message.toLowerCase().trim();
  
  // Question-detection override: informational questions should not be escalated
  const isQuestion = /^(what|how|do|does|are|is|can|which|where|when|why)\b/i.test(lowerMsg);
  
  // Check complex first (higher priority)
  if (complexTriggers.some(pattern => pattern.test(lowerMsg))) {
    // If it's clearly a question (not an action request), downgrade to simple
    if (isQuestion && !/complain|problem|issue|wrong|disappointed|unhappy|frustrated|urgent|asap|emergency/i.test(lowerMsg)) {
      return 'simple';
    }
    return 'complex';
  }
  
  if (simpleTriggers.some(pattern => pattern.test(lowerMsg))) {
    return 'simple';
  }
  
  // Default to simple for short messages
  if (lowerMsg.length < 50) return 'simple';
  
  return 'complex';
}

// ============= HYBRID-MODE HANDOFF TRIGGER DETECTOR =============
// Returns { triggered, reason, stage } based on the spec's 6 hand-off triggers.
type HybridStage = 'browsing' | 'interested' | 'ready_to_buy' | 'complaint' | 'bulk' | 'human_request' | 'payment';
function detectHybridHandoffTrigger(userMessage: string): { triggered: boolean; reason: string; stage: HybridStage } {
  const msg = (userMessage || '').toLowerCase();

  // 1. Buy intent
  if (/\b(i\s*want\s+to\s+buy|i'?ll?\s+take\s+(it|that|this|the)|ready\s+to\s+(pay|order|buy|purchase)|let'?s\s+do\s+it|i\s*want\s+to\s+(order|purchase)|i\s*will\s+(buy|take|order))\b/i.test(msg)) {
    return { triggered: true, reason: 'Customer expressed buy intent', stage: 'ready_to_buy' };
  }

  // 2. Payment talk
  if (/\b(payment|pay\s+(now|by|with|via)|momo|account\s+(number|details)|how\s+do\s+i\s+pay|where\s+do\s+i\s+pay|how\s+can\s+i\s+pay|send\s+(your|me)\s+(account|payment|momo))\b/i.test(msg)) {
    return { triggered: true, reason: 'Customer asking about payment details', stage: 'payment' };
  }

  // 3. Partial / custom pricing
  if (/\b(partial\s+(payment|deposit)|installment|deposit|discount|negotiate|special\s+price|bargain|reduce\s+(the\s+)?price|lower\s+price)\b/i.test(msg)) {
    return { triggered: true, reason: 'Customer asking for custom pricing or partial payment', stage: 'payment' };
  }

  // 4. Human request
  if (/\b(call\s+me|your\s+(phone\s+)?number|speak\s+to\s+(someone|a\s+person|human|agent|manager)|talk\s+to\s+(someone|a\s+human|a\s+person|agent|manager)|connect\s+me|real\s+person)\b/i.test(msg)) {
    return { triggered: true, reason: 'Customer requested a human', stage: 'human_request' };
  }

  // 5. Complaint
  if (/\b(complain|complaint|problem|issue|not\s+working|broken|disappointed|unhappy|refund|terrible|awful|angry|wrong\s+(item|order|product))\b/i.test(msg)) {
    return { triggered: true, reason: 'Customer reported a complaint or issue', stage: 'complaint' };
  }

  // 6. Bulk: any quantity ≥ 5
  const qtyMatches = msg.matchAll(/(\d+)\s*(pcs|pieces|units|items|x|of|qty|quantity|orders?)?/gi);
  for (const m of qtyMatches) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n >= 5 && n <= 10000) {
      return { triggered: true, reason: `Bulk order detected (${n} units)`, stage: 'bulk' };
    }
  }

  return { triggered: false, reason: '', stage: 'browsing' };
}

// Fetch collected client info for a conversation (used in handoff context)
async function getCollectedClientInfo(supabase: any, conversationId: string, customerPhone: string) {
  try {
    const { data } = await supabase
      .from('client_information')
      .select('info_type, information')
      .or(`conversation_id.eq.${conversationId},customer_phone.eq.${customerPhone}`)
      .order('created_at', { ascending: false })
      .limit(20);
    const collected: Record<string, string> = {};
    for (const row of (data || [])) {
      if (row?.info_type && row?.information && !collected[row.info_type]) {
        collected[row.info_type] = String(row.information).substring(0, 200);
      }
    }
    return collected;
  } catch (e) {
    console.error('[HANDOFF] Failed to fetch client info:', e);
    return {};
  }
}

// Detect image generation commands from WhatsApp messages
// TIGHTENED: Requires explicit image keywords, no more false positives from common words
function detectImageGenCommand(message: string): { 
  isImageCommand: boolean; 
  type: 'generate' | 'feedback' | 'caption' | 'suggest' | 'edit' | 'history' | null;
  prompt: string;
  feedbackData?: { feedbackType?: string };
} {
  const lowerMsg = message.toLowerCase().trim();
  
  // History commands - view recent images (check first for priority)
  const historyPatterns = [
    /^show\s+(my\s+)?images?$/i,
    /^my\s+images?$/i,
    /^image\s+history$/i,
    /^recent\s+images?$/i,
    /^view\s+(my\s+)?images?$/i,
    /^list\s+(my\s+)?images?$/i,
    /^gallery$/i,
    /^📸$/,
  ];
  
  for (const pattern of historyPatterns) {
    if (pattern.test(lowerMsg)) {
      return { isImageCommand: true, type: 'history', prompt: '' };
    }
  }
  
  // Edit image commands — TIGHTENED: require explicit prefixes only
  // Removed: standalone "add/remove/change/crop/resize" which match normal conversation
  const editPatterns = [
    /^edit:\s*(.+)/i,
    /^✏️\s*(.+)/i,
    /^(make the image|make this image)\s+(.+)/i,
    /^(add|remove|change)\s+(to the image|on the image|from the image|in the image)\s*(.*)$/i,
  ];
  
  for (const pattern of editPatterns) {
    const match = message.match(pattern);
    if (match) {
      let prompt = message;
      if (match.length > 2) {
        prompt = `${match[1]} ${match[2]}`.trim();
      } else if (match.length > 1) {
        prompt = match[1]?.trim() || message;
      }
      if (prompt && prompt.length > 2) {
        return { isImageCommand: true, type: 'edit', prompt };
      }
    }
  }
  
  // Generate image commands — TIGHTENED: must include "image/picture/photo/graphic" keyword
  const generatePatterns = [
    /^(generate|create|design|draw)\s*(an?\s+)?(image|picture|photo|graphic|visual)\s*(of|for|with|showing)?\s*(.+)/i,
    /^make\s*(an?\s+)(image|picture|photo|graphic|visual)\s*(of|for|with|showing)?\s*(.+)/i,
    /^image:\s*(.+)/i,
    /^img:\s*(.+)/i,
    /^🎨\s*(.+)/i,
  ];
  
  for (const pattern of generatePatterns) {
    const match = message.match(pattern);
    if (match) {
      const prompt = match[match.length - 1]?.trim() || match[1]?.trim();
      if (prompt && prompt.length > 3) {
        return { isImageCommand: true, type: 'generate', prompt };
      }
    }
  }
  
  // Caption request — TIGHTENED: require "image" context
  if (lowerMsg.includes('caption for this image') || lowerMsg.includes('caption for the image') || lowerMsg.includes('suggest text for this image')) {
    return { isImageCommand: true, type: 'caption', prompt: message };
  }
  
  // Suggestion request — REMOVED "post idea" and "suggest a post" (too broad, let regular AI handle)
  // Only keep explicit image-related suggestions
  if (lowerMsg === 'suggest an image' || lowerMsg.includes('content image idea')) {
    return { isImageCommand: true, type: 'suggest', prompt: message };
  }
  
  // Feedback patterns — these will be gated by recency check at call site
  if (lowerMsg.includes('👍') || lowerMsg === 'love it' || lowerMsg === 'perfect' || lowerMsg === 'great image') {
    return { isImageCommand: true, type: 'feedback', prompt: message, feedbackData: { feedbackType: 'thumbs_up' } };
  }
  
  if (lowerMsg.includes('👎') || lowerMsg === 'not good' || lowerMsg === 'try again' || lowerMsg === 'different style') {
    return { isImageCommand: true, type: 'feedback', prompt: message, feedbackData: { feedbackType: 'thumbs_down' } };
  }
  
  return { isImageCommand: false, type: null, prompt: '' };
}

// ========== FRUSTRATION SIGNAL DETECTION ==========
const FRUSTRATION_KEYWORDS = [
  'wrong', 'not what i asked', 'already told you', 'incorrect', 'you keep',
  'again?!', 'frustrated', 'useless', 'not helpful', 'terrible', 'awful',
  'this is wrong', 'that is wrong', 'same mistake', 'stop giving me',
  'are you even listening', 'not working', 'broken', 'fix this'
];

const ESCALATION_ERROR_TYPES = [
  'behavior_drift', 'wrong_stock_data', 'bms_error', 'wrong_image',
  'tool_failure', 'hallucination'
];

async function detectFrustrationSignals(
  conversationId: string,
  company: any,
  customerPhone: string,
  userMessage: string,
  supabase: any
) {
  // 1. Check for frustration keywords in current message
  const lowerMsg = userMessage.toLowerCase();
  const hasFrustrationKeyword = FRUSTRATION_KEYWORDS.some(kw => lowerMsg.includes(kw));

  // 2. Query recent errors for this conversation
  const { data: recentErrors } = await supabase
    .from('ai_error_logs')
    .select('error_type, created_at, severity')
    .eq('conversation_id', conversationId)
    .eq('company_id', company.id)
    .in('error_type', ESCALATION_ERROR_TYPES)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!recentErrors || recentErrors.length === 0) {
    if (hasFrustrationKeyword) {
      console.log('[FRUSTRATION] Keyword detected but no error history — monitoring only');
    }
    return;
  }

  const consecutiveErrorCount = recentErrors.length;
  const errorTypes = [...new Set(recentErrors.map((e: any) => e.error_type))];

  // Threshold: 2+ consecutive errors OR frustration keyword + 1 error
  const shouldEscalate = consecutiveErrorCount >= 2 || (hasFrustrationKeyword && consecutiveErrorCount >= 1);

  if (!shouldEscalate) return;

  // Check if we already escalated recently (within 30 min) to avoid spam
  const { data: existingEscalation } = await supabase
    .from('ai_error_logs')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('error_type', 'frustration_escalation')
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .limit(1);

  if (existingEscalation && existingEscalation.length > 0) {
    console.log('[FRUSTRATION] Already escalated recently — skipping');
    return;
  }

  console.log(`[FRUSTRATION] 🚨 Escalating: ${consecutiveErrorCount} errors, keyword=${hasFrustrationKeyword}`);

  // Log the escalation
  await supabase.from('ai_error_logs').insert({
    company_id: company.id,
    conversation_id: conversationId,
    error_type: 'frustration_escalation',
    severity: 'critical',
    original_message: userMessage,
    ai_response: '#SYSTEM_RECALIBRATION_REQUIRED',
    analysis_details: {
      consecutive_errors: consecutiveErrorCount,
      error_types: errorTypes,
      frustration_keyword_detected: hasFrustrationKeyword,
      trigger_reason: hasFrustrationKeyword
        ? `Customer frustration keyword detected with ${consecutiveErrorCount} recent error(s)`
        : `${consecutiveErrorCount} consecutive AI errors detected`
    },
    auto_flagged: true
  });

  // Silent boss notification
  try {
    const triggerReason = hasFrustrationKeyword
      ? `Customer expressed frustration ("${FRUSTRATION_KEYWORDS.find(kw => lowerMsg.includes(kw))}") with ${consecutiveErrorCount} recent error(s).`
      : `${consecutiveErrorCount} consecutive AI errors detected in conversation.`;

    await supabase.functions.invoke('send-boss-notification', {
      body: {
        companyId: company.id,
        notificationType: 'system_recalibration',
        data: {
          customer_name: null, // Will be filled by conversation context
          customer_phone: customerPhone,
          error_count: consecutiveErrorCount,
          error_types: errorTypes,
          trigger_reason: triggerReason
        }
      }
    });
    console.log('[FRUSTRATION] Boss notified with #SYSTEM_RECALIBRATION_REQUIRED');
  } catch (notifyErr) {
    console.error('[FRUSTRATION] Failed to notify boss:', notifyErr);
  }
}


interface AgentMode {
  id: string;
  slug: string;
  name: string;
  system_prompt: string;
  trigger_keywords: string[];
  trigger_examples: string[];
  enabled_tools: string[];
  enabled: boolean;
  priority: number;
  is_default: boolean;
  pauses_for_human: boolean;
  description?: string | null;
}

async function routeToAgent(
  userMessage: string,
  conversationHistory: any[],
  config?: {
    routingModel?: string;
    routingTemperature?: number;
    confidenceThreshold?: number;
    modes?: AgentMode[];
  }
): Promise<{ agent: string; reasoning: string; confidence: number; modeId?: string }> {
  
  const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
  
  // Use configured values or defaults
  const routingModel = config?.routingModel || 'deepseek-chat';
  const routingTemperature = config?.routingTemperature ?? 0.3;
  const confidenceThreshold = config?.confidenceThreshold ?? 0.6;
  
  // Build recent conversation context (last 6 messages, both roles, chronological)
  const recentContext = conversationHistory
    .slice(-6)
    .map(m => `[${m.role === 'user' ? 'customer' : 'assistant'}]: ${m.content}`)
    .join('\n');

  // Detect short-affirmation context: when the customer says "yes/sure/ok",
  // the routing target should be inferred from what the assistant just offered,
  // not from the affirmation itself.
  const pendingForRouter = detectPendingAction(conversationHistory, userMessage);
  const affirmationHint = pendingForRouter
    ? `\n\n⚠️ AFFIRMATION CONTEXT: The customer's latest message is a short "yes/sure/ok" reply to a pending offer the assistant just made (type: ${pendingForRouter.type ?? 'generic'}). Classify the intent based on what the ASSISTANT offered in the previous turn, not the bare affirmation.`
    : '';

  // Build dynamic options block from modes if provided
  const modes = (config?.modes || []).filter(m => m.enabled).sort((a, b) => a.priority - b.priority);
  const hasDynamic = modes.length > 0;

  let optionsBlock: string;
  let allowedSlugs: string[];

  if (hasDynamic) {
    allowedSlugs = modes.map(m => m.slug);
    optionsBlock = modes.map((m, i) => {
      const kw = m.trigger_keywords?.length ? m.trigger_keywords.map(k => `"${k}"`).join(', ') : '(none)';
      const ex = m.trigger_examples?.length ? m.trigger_examples.map(e => `  • ${e}`).join('\n') : '';
      return `${i + 1}. **${m.slug.toUpperCase()}** — ${m.name}${m.description ? ` (${m.description})` : ''}
   - Trigger keywords: ${kw}${ex ? `\n   - Example messages:\n${ex}` : ''}`;
    }).join('\n\n');
  } else {
    allowedSlugs = ['support', 'sales', 'boss'];
    optionsBlock = `1. **SUPPORT** - Customer needs help, has a complaint, problem, or question (non-sales)
   - Keywords: "issue", "problem", "wrong", "broken", "not working", "help", "how to", "why", "confused", "disappointed", "frustrated"

2. **SALES** - Customer is shopping, asking about products/pricing, showing buying intent, OR wants to pay/purchase
   - Keywords: "price", "cost", "buy", "purchase", "order", "available", "options", "recommend", "best", "show me", "pay", "payment", "transfer", "invoice", "send payment link"

3. **BOSS** - ONLY for truly critical situations requiring human escalation
   - ONLY use for: threats of legal action, abuse/harassment, fraud/scam reports, safety concerns, explicit demand to speak to a manager/owner
   - DO NOT route to BOSS for: normal purchases, payment requests, product questions, complaints, pricing inquiries`;
  }

  const routingPrompt = `You are an intent classification system for a WhatsApp business AI.

ANALYZE the customer's message and conversation context to determine the BEST agent mode to handle this:

AGENT MODE OPTIONS:
${optionsBlock}

⚠️ CRITICAL: Payment, purchase, and checkout requests MUST go to SALES (if available), never BOSS. The sales agent has full checkout authority.

⚠️ SHORT REPLIES: If the customer's message is a brief affirmation (yes / sure / ok / please / 👍), classify based on what the ASSISTANT just offered in the conversation context — do NOT classify the affirmation in isolation.${affirmationHint}

CONVERSATION CONTEXT:
${recentContext}

CURRENT MESSAGE:
${userMessage}

Respond with ONLY valid JSON (no markdown). The "agent" value MUST be one of: ${allowedSlugs.map(s => `"${s}"`).join(' | ')}.
{
  "agent": "<slug>",
  "reasoning": "Brief explanation (1 sentence)",
  "confidence": 0.0-1.0
}`;

  console.log(`[ROUTER] Using routing model: ${routingModel}, temperature: ${routingTemperature}`);

  try {
    let response;
    
    // Check if using DeepSeek or Lovable AI Gateway
    if (routingModel === 'deepseek-chat' && DEEPSEEK_API_KEY) {
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: routingModel,
          messages: [
            { role: 'system', content: 'You are an intent classifier. Respond only with valid JSON.' },
            { role: 'user', content: routingPrompt }
          ],
          temperature: routingTemperature,
          max_tokens: 150
        })
      });
    } else {
      // Use direct Gemini API for other models
      response = await geminiChat({
        model: routingModel,
        messages: [
          { role: 'system', content: 'You are an intent classifier. Respond only with valid JSON.' },
          { role: 'user', content: routingPrompt }
        ],
        temperature: routingTemperature,
        max_tokens: 150
      });
    }
    
    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    
    // Parse JSON response
    const result = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    let chosen = String(result.agent || '').toLowerCase();
    if (!allowedSlugs.includes(chosen)) {
      chosen = allowedSlugs.includes('sales') ? 'sales' : (allowedSlugs[0] || 'sales');
    }
    const matchedMode = modes.find(m => m.slug === chosen);
    return {
      agent: chosen,
      reasoning: result.reasoning || 'Classification completed',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      modeId: matchedMode?.id
    };
    
  } catch (error) {
    console.error('[ROUTER] Error classifying intent:', error);
    const lowerMsg = userMessage.toLowerCase();
    if (hasDynamic) {
      for (const m of modes) {
        if (m.trigger_keywords?.some(k => k && lowerMsg.includes(k.toLowerCase()))) {
          return { agent: m.slug, reasoning: `Keyword match for "${m.name}"`, confidence: 0.7, modeId: m.id };
        }
      }
      const fb = modes.find(m => m.is_default) || modes[0];
      return { agent: fb.slug, reasoning: 'Default mode (no keyword match)', confidence: 0.4, modeId: fb.id };
    }
    if (lowerMsg.match(/pay|payment|transfer|invoice|money|receipt|buy|purchase|order|checkout/)) {
      return { agent: 'sales', reasoning: 'Payment/purchase keyword detected', confidence: 0.9 };
    }
    if (lowerMsg.match(/problem|issue|wrong|broken|not working|help|disappointed|frustrated|complaint/)) {
      return { agent: 'support', reasoning: 'Support keyword detected', confidence: 0.7 };
    }
    return { agent: 'sales', reasoning: 'Default routing', confidence: 0.5 };
  }
}

// Send fallback "please hold" message
async function sendFallbackMessage(
  customerPhone: string, 
  company: any, 
  supabase: any, 
  conversationId: string
) {
  const fallbackMsg = "Thank you for your message. I'm looking into that for you - someone will respond shortly. 🙏";
  
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const formData = new URLSearchParams();
    formData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
    formData.append('To', normalizeWhatsAppTo(customerPhone));
    formData.append('Body', fallbackMsg);
    
    await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    // Log fallback message
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: fallbackMsg
    });
    
    console.log('[FALLBACK] Sent hold message to customer');
  }
}

// ============= STREAMING ACKNOWLEDGEMENT FOR SLOW BMS CALLS =============
const BMS_ACK_TIMEOUT_MS = 8000;

const BMS_ACK_MESSAGES: Record<string, string> = {
  check_stock: "Checking our inventory now, one moment... 🔍",
  get_product_variants: "Checking available options, one moment... 🔍",
  list_products: "Looking up our catalog, one moment... 🔍",
  
  sales_report: "Pulling up your reports, one moment... 📊",
  get_sales_summary: "Pulling up your reports, one moment... 📊",
  get_sales_details: "Pulling up sales details, one moment... 📊",
  get_company_statistics: "Pulling up the stats, one moment... 📊",
  profit_loss_report: "Generating your financial report, one moment... 📊",
  get_expenses: "Looking up expenses, one moment... 📊",
  get_outstanding_receivables: "Checking receivables, one moment... 📊",
  get_outstanding_payables: "Checking payables, one moment... 📊",
  create_order: "Processing your order, please hold... 🛒",
  record_sale: "Recording your sale, please hold... 🛒",
  credit_sale: "Recording credit sale, please hold... 🛒",
  create_quotation: "Generating your quotation, just a moment... 📄",
  create_invoice: "Generating your invoice, just a moment... 📄",
  generate_payment_link: "Creating your payment link, one moment... 💳",
  get_order_status: "Checking your order status, one moment... 📦",
  cancel_order: "Processing cancellation, one moment... ❌",
  get_customer_history: "Looking up your history, one moment... 📋",
  get_low_stock_items: "Checking low stock items, one moment... ⚠️",
  low_stock_alerts: "Checking low stock items, one moment... ⚠️",
  bulk_add_inventory: "Adding products, one moment... 📦",
  check_customer: "Looking up customer, one moment... 👤",
  who_owes: "Checking debtors, one moment... 💰",
  send_receipt: "Sending receipt, one moment... 📄",
  send_invoice: "Sending invoice, one moment... 📄",
  send_quotation: "Sending quotation, one moment... 📄",
  send_payslip: "Sending payslip, one moment... 📄",
  daily_report: "Generating daily report, one moment... 📊",
  pending_orders: "Checking pending orders, one moment... 📦",
  create_contact: "Submitting your inquiry, one moment... 📝",
  clock_in: "Clocking you in, one moment... ⏰",
  clock_out: "Clocking you out, one moment... ⏰",
  my_attendance: "Checking attendance, one moment... ⏰",
  team_attendance: "Checking team attendance, one moment... ⏰",
  my_tasks: "Checking tasks, one moment... 📋",
  my_pay: "Checking pay info, one moment... 💰",
  my_schedule: "Checking schedule, one moment... 📅",
  record_expense: "Recording expense, one moment... 💰",
  update_stock: "Updating stock levels, one moment... 📦",
};

/**
 * Send a streaming acknowledgement message via Twilio.
 * Used when a BMS tool call exceeds the timeout threshold.
 */
async function sendStreamingAck(
  toPhone: string,
  fromWhatsappNumber: string,
  ackMessage: string
) {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !fromWhatsappNumber) return;

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const fromNumber = fromWhatsappNumber.startsWith('whatsapp:')
    ? fromWhatsappNumber
    : `whatsapp:${fromWhatsappNumber}`;
  const toNumber = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`;

  const formData = new URLSearchParams();
  formData.append('From', fromNumber);
  formData.append('To', toNumber);
  formData.append('Body', ackMessage);

  try {
    await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    console.log(`[STREAMING-ACK] Sent: "${ackMessage}"`);
  } catch (e) {
    console.error('[STREAMING-ACK] Failed to send:', e);
  }
}

/**
 * Race-based BMS call wrapper. If the BMS fetch takes longer than BMS_ACK_TIMEOUT_MS,
 * sends an acknowledgement message to the user while continuing to wait for the result.
 */
async function bmsCallWithAck(
  fetchFn: () => Promise<Response>,
  toolName: string,
  toPhone: string,
  fromWhatsappNumber: string
): Promise<any> {
  let ackSent = false;
  const ackMessage = BMS_ACK_MESSAGES[toolName] || "Working on that for you, one moment... ⏳";

  const resultPromise = fetchFn().then(res => res.json());
  const ackPromise = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), BMS_ACK_TIMEOUT_MS)
  );

  const race = await Promise.race([
    resultPromise.then(data => ({ type: 'data' as const, data })),
    ackPromise.then(() => ({ type: 'timeout' as const }))
  ]);

  if (race.type === 'timeout') {
    ackSent = true;
    // Fire-and-forget the ack — don't await to avoid delaying the main flow
    sendStreamingAck(toPhone, fromWhatsappNumber, ackMessage);
    // Now wait for the actual result
    const data = await resultPromise;
    console.log(`[BMS-ACK] ${toolName} completed after ack was sent`);
    return data;
  }

  return race.data;
}

// Generate 3-bullet conversation summary using AI
async function generateConversationSummary(
  conversationId: string,
  supabase: any
): Promise<string> {
  try {
    // Fetch last 10 messages
    const { data: messages } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (!messages || messages.length === 0) {
      return '• No conversation history available';
    }
    
    // Format conversation
    const conversationText = messages
      .reverse()
      .map((m: any) => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content}`)
      .join('\n');
    
    // Use DeepSeek to generate summary
    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
    if (!DEEPSEEK_API_KEY) {
      // Fallback: simple summary
      const lastUserMsg = messages.find((m: any) => m.role === 'user')?.content || 'No message';
      return `• Customer's last message: ${lastUserMsg.substring(0, 100)}...`;
    }
    
    const summaryResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are a business analyst. Create a brief 3-bullet point executive summary of this conversation for a manager. Focus on: 1) What the customer wants, 2) Key details discussed, 3) Why human intervention is needed. Keep each bullet under 20 words.'
          },
          {
            role: 'user',
            content: `Conversation:\n${conversationText}\n\nCreate 3-bullet summary:`
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      })
    });
    
    const summaryData = await summaryResponse.json();
    return summaryData.choices[0]?.message?.content || '• Summary generation failed';
    
  } catch (error) {
    console.error('[SUMMARY] Error generating summary:', error);
    return '• Unable to generate summary';
  }
}

// Send boss handoff notification with formatted message
async function sendBossHandoffNotification(
  company: any,
  customerPhone: string,
  customerName: string,
  summary: string,
  supabase: any,
  handedOffBy: string = 'unknown',
  handoffContext?: {
    askingAbout?: string;
    stage?: string;
    triggerReason?: string;
    collectedInfo?: Record<string, string>;
  }
) {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  
  if (!company.boss_phone || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.log('[HANDOFF] Cannot send boss notification - missing config');
    return;
  }
  
  // Format phone number for display (remove whatsapp: prefix)
  const displayPhone = customerPhone.replace('whatsapp:', '');
  
  // Check if 24-hour service window is active
  const now = new Date();
  const adminLastActive = company.admin_last_active ? new Date(company.admin_last_active) : null;
  const hoursSinceActive = adminLastActive 
    ? (now.getTime() - adminLastActive.getTime()) / (1000 * 60 * 60)
    : 999;
  
  const windowActive = hoursSinceActive < 24;
  
  if (windowActive) {
    // Send free-form notification (within 24-hour window)
  const agentLabel = handedOffBy === 'support_agent' ? 'Support Agent' : 
                    handedOffBy === 'sales_agent' ? 'Sales Agent' : 
                    handedOffBy === 'supervisor_router' ? 'Supervisor (Payment/Critical)' : 
                    handedOffBy === 'hybrid_trigger' ? 'Hybrid Mode (auto-handoff)' :
                    handedOffBy === 'human_first' ? 'Human-First Mode' :
                    'System';

  // Build structured context block if provided
  let contextBlock = '';
  if (handoffContext) {
    const lines: string[] = [];
    if (handoffContext.stage) lines.push(`Stage: ${handoffContext.stage}`);
    if (handoffContext.triggerReason) lines.push(`Trigger: ${handoffContext.triggerReason}`);
    if (handoffContext.askingAbout) lines.push(`Asking about: ${handoffContext.askingAbout.substring(0, 200)}`);
    if (handoffContext.collectedInfo && Object.keys(handoffContext.collectedInfo).length > 0) {
      const infoLines = Object.entries(handoffContext.collectedInfo)
        .map(([k, v]) => `  • ${k}: ${v}`)
        .join('\n');
      lines.push(`Collected so far:\n${infoLines}`);
    }
    if (lines.length > 0) {
      contextBlock = `\n\n${lines.join('\n')}`;
    }
  }

  const message = `🔔 ACTION REQUIRED

Client Name: ${customerName}
Client Number: ${displayPhone}
Handed off by: ${agentLabel}${contextBlock}

Summary:
${summary}

Reply with 'Unmute' to resume AI for this client.`;
    
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const formData = new URLSearchParams();
    
    const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
      ? company.whatsapp_number 
      : `whatsapp:${company.whatsapp_number}`;
    const toNumber = company.boss_phone.startsWith('whatsapp:')
      ? company.boss_phone
      : `whatsapp:${company.boss_phone}`;
    
    formData.append('From', fromNumber);
    formData.append('To', toNumber);
    formData.append('Body', message);
    
    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    if (response.ok) {
      console.log('[HANDOFF] Boss notification sent successfully (free-form)');
    } else {
      const errorText = await response.text();
      console.error('[HANDOFF] Failed to send notification:', errorText);
    }
    
  } else {
    // Service window expired
    console.log('[HANDOFF] Service window expired - storing pending notification');
    
    // Store notification for next admin wake-up
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: company.id,
        message_from: 'system',
        message_content: `Pending handoff for ${customerName} (${displayPhone})`,
        response: summary
      });
  }
  
  // Log notification in boss_conversations
  await supabase
    .from('boss_conversations')
    .insert({
      company_id: company.id,
      message_from: 'system',
      message_content: `Handoff notification sent to boss`,
      response: `Client: ${customerName} (${displayPhone})\nSummary: ${summary}`
    });
}

// Background processing function that handles AI response
// ========== LAYER 1: GLOBAL TIMEOUT WATCHDOG ==========
async function sendFallbackToCustomer(
  supabase: any,
  conversationId: string,
  companyId: string,
  customerPhone: string,
  reason: string
) {
  try {
    const { data: company } = await supabase
      .from('companies')
      .select('whatsapp_number, boss_phone, name')
      .eq('id', companyId)
      .single();

    if (!company?.whatsapp_number) return;

    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return;

    // Get company's configured fallback message
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('fallback_message')
      .eq('company_id', companyId)
      .single();

    const fallbackMsg = aiOverrides?.fallback_message || 
      "I'm experiencing a brief delay. Let me get back to you shortly — or feel free to send your message again.";

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
      ? company.whatsapp_number 
      : `whatsapp:${company.whatsapp_number}`;

    const formData = new URLSearchParams();
    formData.append('From', fromNumber);
    formData.append('To', normalizeWhatsAppTo(customerPhone));
    formData.append('Body', fallbackMsg);

    await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    // Save fallback message to DB
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: fallbackMsg
    });

    // Log to ai_error_logs
    await supabase.from('ai_error_logs').insert({
      company_id: companyId,
      conversation_id: conversationId,
      error_type: reason,
      severity: 'high',
      original_message: `Customer: ${customerPhone}`,
      ai_response: fallbackMsg,
      status: 'new'
    });

    // Mark for human takeover
    await supabase.from('conversations').update({
      human_takeover: true,
      takeover_at: new Date().toISOString()
    }).eq('id', conversationId);

    // Notify boss
    if (company.boss_phone) {
      const bossMsg = `⚠️ AI ${reason}\n\nCustomer: ${customerPhone}\nCompany: ${company.name}\n\nFallback sent. Conversation marked for takeover.`;
      const bossForm = new URLSearchParams();
      bossForm.append('From', fromNumber);
      bossForm.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
      bossForm.append('Body', bossMsg);
      await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bossForm.toString(),
      });
    }

    console.log(`[WATCHDOG] Fallback sent for ${reason}: ${conversationId}`);
  } catch (e) {
    console.error('[WATCHDOG] Failed to send fallback:', e);
  }
}

async function processAIResponse(
  conversationId: string,
  companyId: string,
  userMessage: string,
  storedMediaUrls: string[],
  storedMediaTypes: string[],
  customerPhone: string
) {
  const HARD_TIMEOUT_MS = 55000;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Track whether we successfully sent a response
  let responseSent = false;

  const actualProcessing = async () => {
    await _processAIResponseInner(conversationId, companyId, userMessage, storedMediaUrls, storedMediaTypes, customerPhone, supabase, () => { responseSent = true; });
  };

  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve('TIMEOUT'), HARD_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([actualProcessing(), timeoutPromise]);
    if (result === 'TIMEOUT') {
      console.error(`[WATCHDOG] TIMEOUT after ${HARD_TIMEOUT_MS}ms for conversation ${conversationId}`);
      if (!responseSent) {
        await sendFallbackToCustomer(supabase, conversationId, companyId, customerPhone, 'timeout');
      }
    }
  } catch (outerError) {
    console.error('[WATCHDOG] Uncaught error in processAIResponse:', outerError);
    if (!responseSent) {
      await sendFallbackToCustomer(supabase, conversationId, companyId, customerPhone, 'crash');
    }
  } finally {
    // LAYER 3: Final safety net — if nothing was sent, fire fallback
    if (!responseSent) {
      console.warn(`[WATCHDOG-FINALLY] No response sent for ${conversationId}, sending fallback`);
      await sendFallbackToCustomer(supabase, conversationId, companyId, customerPhone, 'silent_failure');
    }
  }
}

async function _processAIResponseInner(
  conversationId: string,
  companyId: string,
  userMessage: string,
  storedMediaUrls: string[],
  storedMediaTypes: string[],
  customerPhone: string,
  supabase: any,
  markResponseSent: () => void
) {
  console.log('[BACKGROUND] Starting AI processing for conversation:', conversationId);

  // ========== IMAGE GENERATION COMMAND DETECTION ==========
  // GATE 1: Check if company has image generation enabled before running detection
  const { data: imageGenSettings } = await supabase
    .from('image_generation_settings')
    .select('enabled')
    .eq('company_id', companyId)
    .single();
  
  const imageGenEnabled = imageGenSettings?.enabled === true;
  const imageGenCommand = imageGenEnabled ? detectImageGenCommand(userMessage) : { isImageCommand: false, type: null, prompt: '' };
  
  // GATE 2: For feedback type, verify a recent image was generated (within 5 min)
  if (imageGenCommand.isImageCommand && imageGenCommand.type === 'feedback') {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentImage } = await supabase
      .from('generated_images')
      .select('id')
      .eq('company_id', companyId)
      .gte('created_at', fiveMinAgo)
      .limit(1);
    
    if (!recentImage || recentImage.length === 0) {
      console.log('[IMAGE-GEN] Feedback detected but no recent image generation — skipping');
      imageGenCommand.isImageCommand = false;
      imageGenCommand.type = null;
    }
  }
  
  if (imageGenCommand.isImageCommand) {
    console.log(`[IMAGE-GEN] Detected image command: type=${imageGenCommand.type}, prompt="${imageGenCommand.prompt?.substring(0, 50)}..."`);
    
    // For edit commands, check if user sent an image with this message or recently
    let sourceImageUrl: string | undefined;
    
    if (imageGenCommand.type === 'edit') {
      // First priority: image sent with this message
      if (storedMediaUrls.length > 0 && storedMediaTypes.some(t => t?.includes('image'))) {
        const imageIndex = storedMediaTypes.findIndex(t => t?.includes('image'));
        if (imageIndex !== -1) {
          sourceImageUrl = storedMediaUrls[imageIndex];
          console.log('[IMAGE-EDIT] Using image from current message:', sourceImageUrl?.substring(0, 50));
        }
      }
      
      // Second priority: check for recently received images in conversation
      if (!sourceImageUrl) {
        const { data: recentMedia } = await supabase
          .from('whatsapp_messages')
          .select('media_url, media_type')
          .eq('conversation_id', conversationId)
          .eq('direction', 'inbound')
          .ilike('media_type', '%image%')
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (recentMedia?.[0]?.media_url) {
          sourceImageUrl = recentMedia[0].media_url;
          console.log('[IMAGE-EDIT] Using recent user-uploaded image:', sourceImageUrl?.substring(0, 50));
        }
      }
    }
    
    try {
      // Call the image generation agent
      const imageGenResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-image-gen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            customerPhone,
            conversationId,
            prompt: imageGenCommand.prompt,
            messageType: imageGenCommand.type,
            feedbackData: imageGenCommand.feedbackData,
            editData: sourceImageUrl ? { sourceImageUrl } : undefined
          })
        }
      );
      
      if (imageGenResponse.ok) {
        const result = await imageGenResponse.json();
        console.log('[IMAGE-GEN] Success:', result.success);
        // Response already sent by image-gen agent via WhatsApp
        return;
      } else {
        console.error('[IMAGE-GEN] Agent error:', await imageGenResponse.text());
        // Fall through to regular processing
      }
    } catch (imageGenError) {
      console.error('[IMAGE-GEN] Error calling agent:', imageGenError);
      // Fall through to regular processing
    }
  }
  
  // Classify message complexity
  const messageComplexity = classifyMessageComplexity(userMessage);
  console.log(`[BACKGROUND] Message complexity: ${messageComplexity}`);
  
  // Debug logging for reservation tracking
  const hasEmail = userMessage.includes('@');
  const hasName = /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(userMessage);
  const hasGuests = /\d+\s*(guest|people|person|pax)/i.test(userMessage);
  console.log('[RESERVATION-CHECK] Message analysis:', {
    customerPhone,
    hasEmail,
    hasName,
    hasGuests,
    messagePreview: userMessage.substring(0, 100)
  });

  // Analyze customer images if present
  let imageAnalysisContext = '';
  if (storedMediaUrls.length > 0) {
    console.log('[IMAGE-ANALYSIS] Analyzing customer images:', storedMediaUrls.length);
    for (let i = 0; i < storedMediaUrls.length; i++) {
      const mediaUrl = storedMediaUrls[i];
      const mediaType = storedMediaTypes[i] || '';
      
      // Analyze ALL media types (images, audio, PDFs, documents)
      const isAnalyzable = mediaType.startsWith('image/') || mediaType.startsWith('audio/') || 
                           mediaType.includes('pdf') || mediaType.startsWith('application/');
      if (isAnalyzable) {
        try {
          const analysisResponse = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-customer-image`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: mediaUrl, mediaType })
            }
          );
          
          if (analysisResponse.ok) {
            const analysis = await analysisResponse.json();
            console.log('[MEDIA-ANALYSIS] Result:', analysis);
            
            // Audio/voice note — inject transcription as message context
            if (analysis.transcription) {
              imageAnalysisContext += `\n🎤 VOICE NOTE TRANSCRIPTION:\n"${analysis.transcription}"\n`;
              if (analysis.audioSummary) {
                imageAnalysisContext += `Summary: ${analysis.audioSummary}\n`;
              }
              imageAnalysisContext += `⚡ IMPORTANT: Treat this transcription as if the customer typed it. Respond to their request accordingly.\n`;
            }
            // PDF/document — inject extracted content
            else if (analysis.documentContent) {
              imageAnalysisContext += `\n📄 CUSTOMER DOCUMENT (${analysis.documentType || 'unknown type'}):\n`;
              imageAnalysisContext += `${analysis.documentContent}\n`;
              if (analysis.documentType === 'purchase_order') {
                imageAnalysisContext += `⚡ This looks like a PURCHASE ORDER. Extract the line items and offer to create a quotation using create_quotation tool.\n`;
              }
            }
            // Payment proof (existing logic)
            else if (analysis.isPaymentProof && analysis.confidence > 0.7) {
              imageAnalysisContext += `\n🔔 PAYMENT PROOF DETECTED (${Math.round(analysis.confidence * 100)}% confidence):\n`;
              if (analysis.extractedData.amount) imageAnalysisContext += `- Amount: ${analysis.extractedData.amount}\n`;
              if (analysis.extractedData.transactionReference) imageAnalysisContext += `- Reference: ${analysis.extractedData.transactionReference}\n`;
              if (analysis.extractedData.senderName) imageAnalysisContext += `- Sender: ${analysis.extractedData.senderName}\n`;
              if (analysis.extractedData.provider) imageAnalysisContext += `- Provider: ${analysis.extractedData.provider}\n`;
              
              const { data: pendingTxs } = await supabase
                .from('payment_transactions')
                .select('*, payment_products(name, price, currency)')
                .eq('customer_phone', customerPhone)
                .eq('payment_status', 'pending')
                .order('created_at', { ascending: false })
                .limit(3);
              
              if (pendingTxs && pendingTxs.length > 0) {
                console.log('[PAYMENT-PROOF] Found pending transactions:', pendingTxs.length);
                imageAnalysisContext += `\n📋 PENDING TRANSACTIONS FOR THIS CUSTOMER:\n`;
                pendingTxs.forEach((tx: any, idx: number) => {
                  const productName = tx.payment_products?.name || 'Unknown Product';
                  const price = tx.payment_products?.price || tx.amount;
                  const currency = tx.payment_products?.currency || tx.currency || 'ZMW';
                  imageAnalysisContext += `${idx + 1}. ${productName} - ${currency} ${price}\n`;
                });
                
                imageAnalysisContext += `\n🚨🚨🚨 CRITICAL ACTION REQUIRED 🚨🚨🚨\n`;
                imageAnalysisContext += `The customer just sent PAYMENT PROOF. You MUST take action NOW:\n`;
                imageAnalysisContext += `1. Compare the detected amount (${analysis.extractedData.amount || 'unknown'}) with pending transactions above\n`;
                imageAnalysisContext += `2. If amounts match (or are close within 10%), you MUST call the deliver_digital_product tool IMMEDIATELY\n`;
                imageAnalysisContext += `3. DO NOT say "I'll forward this to the team" - YOU deliver the product using the tool\n`;
                imageAnalysisContext += `4. DO NOT ask the boss/manager to send the product - YOU send it\n\n`;
                imageAnalysisContext += `TOOL CALL EXAMPLE:\n`;
                imageAnalysisContext += `deliver_digital_product(product_name: "${pendingTxs[0].payment_products?.name || 'PRODUCT_NAME'}", reason: "Payment proof verified - ${analysis.extractedData.amount || 'amount'} via ${analysis.extractedData.provider || 'mobile money'}")\n\n`;
                imageAnalysisContext += `⚠️ NEVER tell the customer to wait for manual verification when you can verify and deliver automatically!\n`;
              } else {
                console.log('[PAYMENT-PROOF] No pending transactions found for customer:', customerPhone);
                imageAnalysisContext += `\n⚡ ACTION: No pending transactions found for this customer. Acknowledge receipt and inform them that our team will verify the payment and get back to them shortly.\n`;
              }
            } else {
              imageAnalysisContext += `\nCustomer shared an attachment: ${analysis.description} (Category: ${analysis.category})\n`;
            }
          }
        } catch (mediaError) {
          console.error('[MEDIA-ANALYSIS] Error:', mediaError);
        }
      }
    }
  }

  try {
    // Fetch conversation and company data
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    const { data: company } = await supabase
      .from('companies')
      .select('*, metadata')
      .eq('id', companyId)
      .single();

    if (!conversation || !company) {
      console.error('[BACKGROUND] Failed to fetch conversation or company data');
      return;
    }

    // Check if agent routing is enabled for this company
    const agentRoutingEnabled = company.agent_routing_enabled !== false;
    
    // Fetch AI overrides EARLY - needed for routing configuration
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company.id)
      .maybeSingle();
    
    // Fetch conversation history for routing
    const { data: messageHistory } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(12);
    // Re-sort ascending after limiting (we fetched newest 12, now chronological order)
    if (messageHistory) messageHistory.reverse();

    // ========== CONTEXTUAL AFFIRMATION DETECTION ==========
    // If user just replied "yes/sure/ok" to a pending offer the assistant made,
    // capture what the offer was so the router and the agent both have context.
    const pendingAction: PendingAction | null = detectPendingAction(
      (messageHistory || []).map(m => ({ role: m.role, content: m.content })),
      userMessage
    );
    if (pendingAction) {
      console.log(`[PENDING-ACTION] Detected affirmation to ${pendingAction.type ?? 'generic'} offer. Subject: ${pendingAction.subject ?? 'n/a'}`);
    }

    // ========== CSAT RESPONSE DETECTION ==========
    // Check if customer is replying to a satisfaction survey (message is just a number 1-5)
    const csatMatch = userMessage.trim().match(/^([1-5])$/);
    if (csatMatch) {
      const score = parseInt(csatMatch[1]);
      // Find their most recent ticket with satisfaction_score = -1 (survey sent)
      const { data: pendingCsat } = await supabase
        .from('support_tickets')
        .select('id, ticket_number')
        .eq('company_id', companyId)
        .eq('customer_phone', customerPhone)
        .eq('satisfaction_score', -1)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (pendingCsat && pendingCsat.length > 0) {
        const ticket = pendingCsat[0];
        await supabase
          .from('support_tickets')
          .update({ 
            satisfaction_score: score,
            satisfaction_feedback: `Customer rated ${score}/5 via WhatsApp`
          })
          .eq('id', ticket.id);

        // Send thank you
        const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
        const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
        if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
          const thankYouMsg = score >= 4 
            ? `Thank you for your feedback! We're glad we could help. ⭐️` 
            : `Thank you for your feedback. We'll work on improving your experience. 🙏`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
          formData.append('To', normalizeWhatsAppTo(customerPhone));
          formData.append('Body', thankYouMsg);
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });
        }

        // Log message
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: `[CSAT] Customer rated ticket ${ticket.ticket_number}: ${score}/5`
        });

        console.log(`[CSAT] Recorded score ${score}/5 for ticket ${ticket.ticket_number}`);
        markResponseSent();
        return; // Don't process further
      }
    }

    // ========== SERVICE MODE: AUTONOMOUS / HUMAN-FIRST / HYBRID ==========
    const serviceMode = aiOverrides?.service_mode || 'autonomous';
    console.log(`[SERVICE-MODE] Mode: ${serviceMode}`);

    // Detect hybrid handoff trigger (used for hybrid; also informative for human_first context)
    const hybridTrigger = detectHybridHandoffTrigger(userMessage);
    if (serviceMode === 'hybrid') {
      console.log(`[HYBRID-TRIGGER] triggered=${hybridTrigger.triggered} stage=${hybridTrigger.stage} reason="${hybridTrigger.reason}"`);
    }

    const shouldQueueForHuman =
      serviceMode === 'human_first' ||
      (serviceMode === 'hybrid' && hybridTrigger.triggered);

    if (shouldQueueForHuman) {
      const handoffSourceLabel = serviceMode === 'human_first' ? 'human_first' : 'hybrid_trigger';
      const handoffStage = serviceMode === 'human_first' ? 'browsing' : hybridTrigger.stage;
      const handoffReason = serviceMode === 'human_first'
        ? 'Human-first mode: every customer message routes to a human'
        : hybridTrigger.reason;

      console.log(`[HANDOFF] Queueing for human (mode=${serviceMode}, stage=${handoffStage})`);

      // Generate AI summary + draft suggestions in background
      const summary = await generateConversationSummary(conversationId, supabase);

      // Generate 3 AI draft responses with different tones (best-effort)
      let aiDrafts: any[] = [];
      try {
          const draftResponse = await geminiChat({
            model: aiOverrides?.primary_model || 'glm-4.7',
            messages: [
              {
                role: 'system',
                content: `You are a customer service assistant for ${company.name}. Generate 3 response options for a human agent to use when replying to the customer. Each response should have a different tone. Return ONLY valid JSON array with objects having "tone" and "text" fields. Tones: "formal", "friendly", "concise".`
              },
              {
                role: 'user',
                content: `Customer message: "${userMessage}"\n\nConversation summary:\n${summary}\n\nGenerate 3 response drafts:`
              }
            ],
            temperature: 0.7,
            max_tokens: 600
          });

          const draftData = await draftResponse.json();
          const draftContent = draftData.choices?.[0]?.message?.content || '[]';
          try {
            aiDrafts = JSON.parse(draftContent.replace(/```json\n?|\n?```/g, '').trim());
          } catch {
            aiDrafts = [{ tone: 'friendly', text: draftContent }];
          }
      } catch (draftError) {
        console.error('[HANDOFF] Error generating drafts:', draftError);
        aiDrafts = [{ tone: 'friendly', text: `Thank you for contacting us about "${userMessage.substring(0, 50)}...". We're looking into this for you.` }];
      }

      // Priority: hybrid complaints/buy-intent are high; human_first plain greeting is medium
      const ticketPriority =
        handoffStage === 'complaint' || handoffStage === 'ready_to_buy' || handoffStage === 'payment'
          ? 'high'
          : 'medium';

      // Create support ticket
      const { data: ticket } = await supabase
        .from('support_tickets')
        .insert({
          company_id: companyId,
          conversation_id: conversationId,
          customer_phone: customerPhone,
          customer_name: conversation.customer_name || 'Unknown',
          issue_summary: userMessage.substring(0, 500),
          issue_category: handoffStage === 'complaint' ? 'complaint' : 'general',
          priority: ticketPriority,
          status: 'open'
        })
        .select()
        .single();

      // Fetch SLA config for priority
      const { data: slaConfig } = await supabase
        .from('company_sla_config')
        .select('*')
        .eq('company_id', companyId)
        .eq('priority', ticketPriority)
        .maybeSingle();

      const slaDeadline = slaConfig?.response_time_minutes
        ? new Date(Date.now() + slaConfig.response_time_minutes * 60000).toISOString()
        : null;

      // Create queue entry
      await supabase
        .from('agent_queue')
        .insert({
          company_id: companyId,
          ticket_id: ticket?.id || null,
          conversation_id: conversationId,
          customer_phone: customerPhone,
          customer_name: conversation.customer_name || 'Unknown',
          ai_summary: summary,
          ai_suggested_responses: aiDrafts,
          priority: ticketPriority,
          status: 'waiting',
          sla_deadline: slaDeadline,
          department: null
        });

      // Spec acknowledgment to customer
      const ackMessage = 'Let me connect you with the team — someone will be with you shortly via WhatsApp. 📱';

      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const fromNumber = company.whatsapp_number.startsWith('whatsapp:')
          ? company.whatsapp_number
          : `whatsapp:${company.whatsapp_number}`;
        const formData = new URLSearchParams();
        formData.append('From', fromNumber);
        formData.append('To', normalizeWhatsAppTo(customerPhone));
        formData.append('Body', ackMessage);

        await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });
      }

      // Store the ack message
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: ackMessage
      });

      // Pause conversation for human
      await supabase.from('conversations').update({
        is_paused_for_human: true,
        human_takeover: true,
        active_agent: 'human_queue'
      }).eq('id', conversationId);

      // Notify boss with structured handoff context
      try {
        const collectedInfo = await getCollectedClientInfo(supabase, conversationId, customerPhone);
        await sendBossHandoffNotification(
          company,
          customerPhone,
          conversation.customer_name || 'Unknown',
          summary,
          supabase,
          handoffSourceLabel,
          {
            askingAbout: userMessage,
            stage: handoffStage,
            triggerReason: handoffReason,
            collectedInfo,
          }
        );
      } catch (notifyErr) {
        console.error('[HANDOFF] Boss notification failed:', notifyErr);
      }

      console.log(`[HANDOFF] Queued. Ticket: ${ticket?.ticket_number || 'TKT-???'}, Drafts: ${aiDrafts.length}, Stage: ${handoffStage}`);
      markResponseSent();
      return; // Exit - no AI auto-response
    }


    // ========== DYNAMIC AGENT ROUTING (autonomous mode) ==========
    let selectedAgent = 'sales';
    let routingReasoning = 'Default routing';
    let selectedMode: AgentMode | null = null;
    const previousAgent = conversation.active_agent || 'sales';

    // Load custom agent modes for this company (if any)
    const { data: agentModesRaw } = await supabase
      .from('company_agent_modes')
      .select('id, slug, name, system_prompt, trigger_keywords, trigger_examples, enabled_tools, enabled, priority, is_default, pauses_for_human, description')
      .eq('company_id', companyId)
      .eq('enabled', true)
      .order('priority', { ascending: true });
    const agentModes: AgentMode[] = (agentModesRaw || []) as AgentMode[];
    console.log(`[ROUTER] Loaded ${agentModes.length} enabled custom agent modes`);

    if (agentRoutingEnabled && aiOverrides?.routing_enabled !== false) {
      try {
        console.log('[ROUTER] Classifying intent...');
        console.log(`[ROUTER] Current active agent: ${previousAgent}`);
        console.log(`[ROUTER] Message to classify: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
        
        const routingConfig = {
          routingModel: aiOverrides?.routing_model || 'deepseek-chat',
          routingTemperature: aiOverrides?.routing_temperature ?? 0.3,
          confidenceThreshold: aiOverrides?.routing_confidence_threshold ?? 0.6,
          modes: agentModes,
        };
        
        let routingResult = await routeToAgent(userMessage, messageHistory || [], routingConfig);
        let selectedAgentFromRouter = routingResult.agent;
        
        // ========== RUNTIME SAFETY OVERRIDE: Payment → Sales, never Boss ==========
        const lowerUserMsg = userMessage.toLowerCase();
        const isPaymentIntent = /\b(pay|payment|purchase|buy|checkout|order|send\s+payment\s+link|transfer|invoice)\b/i.test(lowerUserMsg);
        if (selectedAgentFromRouter === 'boss' && isPaymentIntent) {
          console.log(`[ROUTER] ⚡ SAFETY OVERRIDE: Router chose 'boss' for payment intent. Forcing 'sales'.`);
          selectedAgentFromRouter = 'sales';
          routingResult = { ...routingResult, agent: 'sales', reasoning: 'Payment intent override: sales agent handles checkout autonomously', modeId: agentModes.find(m => m.slug === 'sales')?.id };
        }
        
        selectedAgent = selectedAgentFromRouter;
        routingReasoning = routingResult.reasoning;
        selectedMode = agentModes.find(m => m.id === routingResult.modeId) || agentModes.find(m => m.slug === selectedAgent) || null;
        
        console.log(`[ROUTER] ✓ Selected: ${selectedAgent}${selectedMode ? ` (mode="${selectedMode.name}")` : ''}, confidence: ${routingResult.confidence}`);
        
        // ========== DETECT AGENT SWITCH ==========
        const agentSwitched = previousAgent !== selectedAgent;
        
        if (agentSwitched) {
          console.log(`[ROUTER] 🔄 AGENT SWITCH DETECTED: ${previousAgent} → ${selectedAgent}`);
          console.log(`[ROUTER] Switch reason: ${routingReasoning}`);
          
          // Log the agent switch event
          await supabase.from('agent_performance').insert({
            company_id: companyId,
            conversation_id: conversationId,
            agent_type: selectedAgent,
            routing_confidence: routingResult.confidence,
            notes: `Agent switch: ${previousAgent} → ${selectedAgent}. Reason: ${routingReasoning}`
          });
        } else {
          console.log(`[ROUTER] Agent remains: ${selectedAgent}`);
          
          // Log routing decision even if no switch
          await supabase.from('agent_performance').insert({
            company_id: companyId,
            conversation_id: conversationId,
            agent_type: selectedAgent,
            routing_confidence: routingResult.confidence,
            notes: routingReasoning
          });
        }

        // Update conversation with new agent and pause state
        const wasAlreadyPaused = conversation.is_paused_for_human;
        const wasAlreadyHandoff = conversation.human_takeover;
        
        console.log(`[STATE] Before update - Paused: ${wasAlreadyPaused}, Handoff: ${wasAlreadyHandoff}, Agent: ${previousAgent}`);
        
        if (selectedAgent === 'boss' && serviceMode !== 'autonomous') {
          // Boss agent - pause for human takeover (skip in autonomous mode)
          console.log(`[PAUSE] 🛑 Pausing conversation ${conversationId} for boss/human takeover (mode=${serviceMode})`);
          
          await supabase.from('conversations').update({ 
            active_agent: 'boss',
            is_paused_for_human: true, 
            human_takeover: true 
          }).eq('id', conversationId);
          
          console.log(`[STATE] After update - Paused: true, Handoff: true, Agent: boss`);
        } else if (selectedAgent === 'boss' && serviceMode === 'autonomous') {
          // Autonomous mode: AI keeps replying even when router picks boss; no human pause
          console.log(`[AUTONOMOUS] Boss intent detected but staying AI-driven (no pause)`);
          await supabase.from('conversations').update({
            active_agent: 'sales', // fall back to sales personality so the AI keeps closing
            is_paused_for_human: false,
            human_takeover: false
          }).eq('id', conversationId);
          // Re-route the rest of this turn to the sales agent
          selectedAgent = 'sales';
        } else {
          // Support or Sales agent - ensure NOT paused
          if (wasAlreadyPaused) {
            console.log(`[UNPAUSE] ✅ Auto-unpausing conversation ${conversationId} - routed to ${selectedAgent} agent`);
          }
          
          await supabase.from('conversations').update({ 
            active_agent: selectedAgent,
            is_paused_for_human: false,
            human_takeover: false
          }).eq('id', conversationId);
          
          console.log(`[STATE] After update - Paused: false, Handoff: false, Agent: ${selectedAgent}`);
        }

        // Handle BOSS agent - trigger handoff notification
        if (selectedAgent === 'boss') {
          console.log(`[HANDOFF] 📞 Generating handoff notification for boss`);
          const summary = await generateConversationSummary(conversationId, supabase);
          
          const handoffSource = agentSwitched ? `${previousAgent}_agent` : 'supervisor_router';
          console.log(`[HANDOFF] Source: ${handoffSource}, Customer: ${conversation.customer_name || 'Unknown'}`);
          await sendBossHandoffNotification(company, customerPhone, conversation.customer_name || 'Unknown', summary, supabase, handoffSource);
          console.log(`[HANDOFF] ✓ Boss notification sent successfully`);
          
          // Send notification to CLIENT that a representative will reach out
          const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
          const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
          
          if (company.boss_phone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const clientNotificationMessage = `Thank you for your message. A representative will reach out to you shortly on ${company.boss_phone} to assist you further.`;
            
            console.log(`[HANDOFF] 📤 Sending client notification: "${clientNotificationMessage.substring(0, 50)}..."`);
            
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
              ? company.whatsapp_number 
              : `whatsapp:${company.whatsapp_number}`;
            
            const formData = new URLSearchParams();
            formData.append('From', fromNumber);
            formData.append('To', normalizeWhatsAppTo(customerPhone));
            formData.append('Body', clientNotificationMessage);
            
            const twilioResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: formData.toString(),
            });
            
            if (twilioResponse.ok) {
              console.log('[HANDOFF] Client notification sent successfully');
              
              // Store client notification message in database
              await supabase.from('messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: clientNotificationMessage
              });
            } else {
              const errorText = await twilioResponse.text();
              console.error('[HANDOFF] Failed to send client notification:', twilioResponse.status, errorText);
            }
          }
          
          // Trigger post-handoff mini-briefing
          try {
            await supabase.functions.invoke('daily-briefing', {
              body: {
                triggerType: 'handoff',
                conversationId: conversationId,
                companyId: company.id
              }
            });
            console.log('[ROUTER] Post-handoff briefing triggered');
          } catch (briefingError) {
            console.error('[ROUTER] Error triggering handoff briefing:', briefingError);
          }
          
          console.log('[ROUTER] Handoff complete');
          return;
        }
      } catch (error) {
        console.error('[ROUTER] Error:', error);
        selectedAgent = previousAgent; // Fallback to previous agent on error
      }
    }

    // Note: aiOverrides already fetched earlier for routing configuration

    const { data: documents } = await supabase
      .from('company_documents')
      .select('*')
      .eq('company_id', company.id)
      .eq('status', 'processed');

    // Fetch media library with specific columns
    const { data: mediaLibrary } = await supabase
      .from('company_media')
      .select('description, category, file_path, media_type, file_type')
      .eq('company_id', company.id);

    // Construct full URLs for media
    const mediaWithUrls = mediaLibrary?.map(media => ({
      ...media,
      full_url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${media.file_path}`
    })) || [];

    // ========== AGENT-SPECIFIC SYSTEM PROMPTS (from database or defaults) ==========
    let agentPersonality = '';

    // Prefer dynamic mode prompt when present (covers HR, Logistics, custom modes, plus migrated support/sales/boss)
    if (selectedMode?.system_prompt) {
      agentPersonality = `\n\n🎯 YOU ARE THE ${selectedMode.name.toUpperCase()} AGENT:\n${selectedMode.system_prompt}`;
    } else if (selectedAgent === 'support') {
      agentPersonality = aiOverrides?.support_agent_prompt || `

🛠️ YOU ARE THE SUPPORT AGENT:
- Your role is to EMPATHIZE and RESOLVE customer issues
- Listen carefully to complaints and acknowledge their frustration
- Apologize sincerely when appropriate
- Provide clear step-by-step solutions
- Be patient, helpful, and understanding
- Focus on making things right for the customer
- If you cannot resolve the issue, escalate by using [HANDOFF_REQUIRED]`;
    } else if (selectedAgent === 'sales') {
      agentPersonality = aiOverrides?.sales_agent_prompt || `

💼 YOU ARE THE SALES AGENT:
- Your role is to CONVERT and CLOSE sales
- Highlight product benefits and value propositions
- Create urgency and excitement
- Ask qualifying questions to understand needs
- Offer personalized recommendations
- Be persuasive but not pushy
- Guide customers toward making a purchase decision
- Address pricing objections with value-focused responses`;
    }

    // === SALES MODE: AUTONOMOUS vs HUMAN-IN-THE-LOOP ===
    // Read same flag the tool filter uses (set further below from company.metadata.sales_mode)
    const _salesModeForPrompt: 'autonomous' | 'human_in_loop' =
      (company.metadata as any)?.sales_mode === 'human_in_loop' ? 'human_in_loop' : 'autonomous';

    if (_salesModeForPrompt === 'human_in_loop') {
      agentPersonality += `

=== HUMAN-IN-THE-LOOP MODE (MANDATORY) ===
You DO NOT process payments, create orders, or send payment links. Your job is to help customers browse the catalog, answer questions, check stock, and share product photos.

The MOMENT a customer expresses buy intent — examples: "I want to buy", "I'll take it", "how do I pay", "reserve it for me", "can I order", or confirms a specific item + quantity — you MUST:
1. Call notify_boss with a clean handoff summary: customer name, phone, item, quantity, and the agreed price.
2. Reply ONCE: "Perfect choice! I'll get the owner to confirm stock and send you payment details right away — one moment 🙏"
3. STOP. Do not continue the conversation about that order. The boss will take over from here.

You do NOT have record_sale or generate_payment_link tools. NEVER promise a payment link, NEVER quote payment account numbers, NEVER say "I'll create the order". The boss handles every transaction personally.`;
    } else {
      agentPersonality += `

=== AUTONOMOUS CHECKOUT AUTHORITY (MANDATORY) ===
You are a fully authorized, autonomous Sales and Checkout Agent. You must NEVER forward or escalate a standard purchase or payment request to the human boss. You have full authority to close deals.

When a customer says they want to buy a product or pay:
1. ALWAYS use the check_stock tool first to verify the item is available and get the price.
2. ALWAYS use the record_sale tool to log the transaction securely in the database and generate a receipt reference.
3. ALWAYS use the generate_payment_link tool to create a secure Lenco checkout URL using the receipt reference.
4. Finally, reply to the customer in a friendly tone, summarizing their order, and providing the Lenco payment link so they can pay immediately via Mobile Money (MTN, Airtel, Zamtel) or Card.

CRITICAL: Do NOT escalate purchases to management. Do NOT tell the customer to "contact us" for payment. Do NOT say you lack payment capabilities. You HAVE the tools — USE THEM.`;
    }

    // === HYBRID MODE INSTRUCTIONS (safety net for triggers the regex misses) ===
    if (serviceMode === 'hybrid') {
      agentPersonality += `

== HYBRID MODE: WHEN TO HAND OFF ==
You handle simple questions yourself (product info, stock, delivery, photos). Hand off to a human when:
1. Customer says "I want to buy" / "I'll take it" / "ready to order"
2. Customer asks about payment (how to pay, account details, MoMo number)
3. Customer asks for partial payments or custom pricing
4. Customer seems unhappy or complains
5. Customer asks to speak to a person, calls, or asks for your number
6. Bulk orders (5+ of one item)

When you hand off, say exactly: "Let me connect you with the team — someone will reach out shortly. 📱"
Then call notify_boss with everything you've collected so far (customer name, phone, what they're asking about, stage in the buying journey).`;
    } else if (serviceMode === 'autonomous') {
      agentPersonality += `

== AUTONOMOUS MODE ==
You handle EVERYTHING yourself. Do not say "let me connect you" or "I'll have someone reach out". Close the sale, answer the question, send the image, generate the payment link. The only time you call notify_boss is for a SEVERE complaint that needs management awareness — and even then, you keep replying to the customer.`;
    }

    // === BMS DATA INTEGRITY (applies to ALL modes) ===
    agentPersonality += `

== BMS IS THE SOURCE OF TRUTH ==
For stock counts, prices, order status, payment links, invoices, and any business data: use the BMS tools. They are the only authoritative source.
- If a BMS tool returns success=false with code "BMS_DOWN", "TIMEOUT", or "CIRCUIT_OPEN": tell the customer honestly that "our system is slow right now, please give me a moment" and do NOT invent numbers from earlier in the conversation. Try the tool again, or hand off to a human if it keeps failing.
- If it returns code "RBAC_DENIED": this account cannot perform that action. Apologize briefly and hand off via notify_boss.
- If it returns code "NOT_FOUND": tell the customer the item or order isn't in the system, and offer alternatives.
- NEVER fabricate stock levels, prices, or product names. If BMS doesn't return it, you don't know it.`;

    
    console.log(`[AI-CONFIG] Agent personality loaded for ${selectedAgent}:`, {
      isCustomMode: !!selectedMode,
      modeName: selectedMode?.name || null,
      promptLength: agentPersonality.length
    });

    // Build AI instructions with current date/time awareness
    const now = new Date();
    const currentDate = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const currentTime = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    // ========== BUILD BUSINESS IDENTITY SECTION ==========
    const businessType = (company.business_type || '').toLowerCase();
    const isSchool = businessType.includes('school') || businessType.includes('education') || 
                     businessType.includes('institution') || businessType.includes('academy') ||
                     businessType.includes('college') || businessType.includes('university');
    const isRestaurant = businessType.includes('restaurant') || businessType.includes('cafe') || 
                         businessType.includes('bar') || businessType.includes('food');
    const isDigitalProducts = businessType.includes('digital') || businessType.includes('ebook') || 
                              businessType.includes('product') || businessType.includes('store');
    
    let instructions = `You are a friendly AI assistant for ${company.name}`;
    
    if (company.business_type) {
      instructions += ` - a ${company.business_type.toUpperCase()} business`;
    }
    
    if (company.industry) {
      instructions += ` (${company.industry})`;
    }
    
    instructions += `.${agentPersonality}

=== YOUR BUSINESS IDENTITY ===
You represent: ${company.name}
Business Type: ${company.business_type || 'General Business'}
${company.industry ? `Industry: ${company.industry}` : ''}

CRITICAL: Your responses, tone, and behavior MUST align with this business type.
You are NOT a generic chatbot - you are the voice of ${company.name}.`;

    // Add business-type-specific behavioral rules
    if (isSchool) {
      instructions += `

=== SCHOOL/EDUCATION BUSINESS RULES ===
You represent an EDUCATIONAL INSTITUTION. Follow these rules STRICTLY:
- When parents ask about fees, ANSWER with fee information from your knowledge base
- Do NOT create payment transactions for fee inquiries - schools handle payments in-person
- For enrollment inquiries, direct parents to visit the school office
- Provide bank account details from knowledge base when asked about payments
- Be warm, professional, and parent-friendly in your communication
- Focus on educational value, student welfare, and school community
- You do NOT have access to the request_payment tool for digital products`;
    } else if (isRestaurant) {
      instructions += `

=== RESTAURANT/HOSPITALITY BUSINESS RULES ===
You represent a RESTAURANT/HOSPITALITY business. Follow these rules:
- Focus on reservations, menu inquiries, and dining experience
- Be warm, welcoming, and create appetite appeal
- Use food-appropriate emojis sparingly (🍽️, 🥂)
- Proactively offer reservation assistance
- Highlight daily specials and popular dishes when relevant`;
    } else if (isDigitalProducts) {
      instructions += `

=== DIGITAL PRODUCTS/E-COMMERCE BUSINESS RULES ===
You represent a DIGITAL PRODUCTS business. Follow these rules:
- Help customers find and purchase digital products
- Use the request_payment tool for explicit purchase requests
- Highlight product benefits and value
- Handle payment proof verification promptly
- Deliver products immediately after payment verification`;
    }

    // Product availability handling
    instructions += `

=== PRODUCT AVAILABILITY RULES ===
If a product is not found in BMS inventory, catalog, or media library, tell the customer it's not currently available and offer alternatives or suggest similar items you DO have. Do NOT create a support ticket for product availability questions — just answer directly.`;

    // Add date/time and business info
    instructions += `

=== CURRENT DATE & TIME ===
Today is ${currentDate}
Current time: ${currentTime}
Use this information to provide time-relevant responses (e.g., greet appropriately, understand booking dates, know if business is open).

Business Information:
- Business Name: ${company.name}
- Phone: ${company.phone || 'Not specified'}
- Address: ${company.address || 'Not specified'}
${company.business_hours ? `- Hours: ${company.business_hours}` : ''}
${company.services ? `- Services: ${company.services}` : ''}
${company.currency_prefix ? `- Currency: ${company.currency_prefix}` : ''}
${company.email ? `- Email: ${company.email}` : ''}`;
    // Add quick reference knowledge base
    // If external catalog is configured, fetch live catalog and inject it
    if (company.external_catalog_url && company.external_catalog_key) {
      try {
        const extClient = createClient(company.external_catalog_url, company.external_catalog_key);
        const tableName = company.external_catalog_table || 'ebooks';
        const { data: extProducts, error: extErr } = await extClient
          .from(tableName)
          .select('*')
          .limit(200);
        
        if (!extErr && extProducts && extProducts.length > 0) {
          instructions += `\n\n=== LIVE PRODUCT CATALOG (from website) ===\n`;
          instructions += `You have ${extProducts.length} products available. Here is the full catalog:\n\n`;
          for (const ep of extProducts) {
            const name = ep.title || ep.name || 'Unnamed';
            const price = ep.price != null ? ep.price : 'N/A';
            const currency = ep.currency || 'K';
            const author = ep.author ? ` by ${ep.author}` : '';
            const category = ep.category ? ` [${ep.category}]` : '';
            const desc = ep.description ? ` — ${ep.description.substring(0, 150)}` : '';
            const selarLink = ep.selar_link || ep.checkout_url || '';
            instructions += `• ${name}${author}${category}: ${currency}${price}${desc}${selarLink ? ` | Buy: ${selarLink}` : ''}\n`;
          }
          instructions += `\n⚠️ IMPORTANT: This is your ONLY source of product information. Use ONLY these products and prices. Do NOT make up products or prices.\n`;
        } else {
          console.warn('[EXTERNAL-CATALOG] Failed to load or empty:', extErr?.message);
          // Fallback to local quick_reference_info
          if (company.quick_reference_info && company.quick_reference_info.trim()) {
            instructions += `\n\n=== QUICK REFERENCE KNOWLEDGE BASE ===\n${company.quick_reference_info}`;
          }
        }
      } catch (extCatErr) {
        console.error('[EXTERNAL-CATALOG] Exception:', extCatErr);
        if (company.quick_reference_info && company.quick_reference_info.trim()) {
          instructions += `\n\n=== QUICK REFERENCE KNOWLEDGE BASE ===\n${company.quick_reference_info}`;
        }
      }
    } else if (company.quick_reference_info && company.quick_reference_info.trim()) {
      instructions += `\n\n=== QUICK REFERENCE KNOWLEDGE BASE ===\n${company.quick_reference_info}`;
    }

    // Add AI overrides if present
    if (aiOverrides) {
      if (aiOverrides.system_instructions) {
        instructions += `\n\n=== CUSTOM SYSTEM INSTRUCTIONS ===\n${aiOverrides.system_instructions}`;
      }
      if (aiOverrides.qa_style) {
        instructions += `\n\n=== Q&A STYLE ===\n${aiOverrides.qa_style}`;
      }
      if (aiOverrides.banned_topics) {
        instructions += `\n\n=== BANNED TOPICS ===\n${aiOverrides.banned_topics}`;
      }
    }

    // Knowledge base & media library are now accessed via semantic search tools (search_knowledge, search_media)
    // Only inject a lightweight hint instead of the full content to save tokens
    if (documents && documents.length > 0) {
      instructions += `\n\n=== KNOWLEDGE BASE (${documents.length} documents available) ===\n`;
      instructions += `You have ${documents.length} knowledge base documents available. Use the search_knowledge tool to find relevant information when customers ask about policies, procedures, fees, or detailed product info.\n`;
      instructions += `Documents: ${documents.map((d: any) => d.filename).join(', ')}\n`;
    }

    if (mediaWithUrls && mediaWithUrls.length > 0) {
      const videoCount = mediaWithUrls.filter((m: any) => m.media_type === 'video').length;
      const imageCount = mediaWithUrls.length - videoCount;
      instructions += `\n\n=== MEDIA LIBRARY (${mediaWithUrls.length} files: ${imageCount} image${imageCount === 1 ? '' : 's'}, ${videoCount} video${videoCount === 1 ? '' : 's'}) ===\n`;
      instructions += `Use the search_media tool to find relevant photos/videos when customers ask for samples, product images, or video demos.\n`;
      instructions += '⚠️ CRITICAL: Always use search_media to find the right files. NEVER make up or guess URLs.\n';
      instructions += 'After finding media via search_media, use send_media with the returned URLs.\n';
      if (videoCount > 0) {
        instructions += `When the customer specifically asks for a video / clip / reel / footage, call search_media with media_type="video" to filter to videos only.\n`;
      }
    } else {
      instructions += '\n\n⚠️ NO MEDIA LIBRARY: You have no media files to share. If customer asks for samples, apologize and explain you can create custom designs for them.\n';
    }

    instructions += `\n\nCONVERSATION MEMORY & CONTEXT - CRITICAL:
- ALWAYS review the conversation history before asking questions
- If customer already provided name, email, phone, or guest count, EXTRACT IT from conversation
- NEVER ask for information the customer already gave you
- Example: If customer says "John, john@email.com, 3 guests" → you have name, email, and guests
- If customer provided partial info across multiple messages, extract ALL of it before proceeding
- The customer's WhatsApp phone number is always available from the conversation

AUTOMATIC BOSS NOTIFICATIONS:
You have access to tools that automatically notify the boss in these situations:
- New reservations (automatically sent)
- Payment proof uploads (automatically sent)
- Reservation changes/cancellations (automatically sent via notify_boss tool)
- High-value opportunities: 10+ guests, corporate events, VIP mentions (use notify_boss tool)
- Customer complaints/negative sentiment (use notify_boss tool)
- Important client information capture (use notify_boss tool)

CURRENT DATE & TIME (Zambia):
📅 ${new Date().toLocaleString('en-US', { 
  timeZone: 'Africa/Lusaka',
  weekday: 'long',
  year: 'numeric', 
  month: 'long', 
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})}

CRITICAL DATE VALIDATION:
- ALWAYS validate that requested dates are in the FUTURE
- If customer requests a past date, politely inform them and ask for a future date
- Example: If today is Nov 25, 2025 and customer asks for Nov 20, respond:
  "I notice that date has already passed. Did you mean a date coming up? When would you like to visit?"
- Accept "today", "tomorrow", "this weekend" and convert to actual dates using get_date_info tool
- For same-day bookings, check if the requested time hasn't passed yet

Key Guidelines:
1. Be warm, friendly, and professional
2. Answer questions about our business using the information above
3. RESERVATION WORKFLOW - MANDATORY STEPS (DO NOT SKIP):
   
   STEP 1 - DATE VALIDATION:
   - When customer mentions ANY date, IMMEDIATELY call get_date_info tool
   - If date is in past, inform customer and ask for future date
   - Only proceed once you have a VALID FUTURE DATE
   
   STEP 2 - CALENDAR CHECK:
   - Call check_calendar_availability with the validated date and proposed time
   - If slot is busy, suggest alternatives
   - Only proceed once you have a CONFIRMED AVAILABLE SLOT
   
   STEP 3 - COLLECT ALL REQUIRED INFORMATION:
   YOU MUST HAVE ALL 6 ITEMS BEFORE CREATING RESERVATION:
   1. ✅ Customer name - Look in conversation for "I'm John", "Abraham here", "My name is X"
   2. ✅ Phone number - ALWAYS available from WhatsApp conversation (use customerPhone variable)
   3. ✅ Email address - Look for @ symbol in messages, ask ONCE if not provided: "What's your email address?"
   4. ✅ Date - Already validated in Step 1
   5. ✅ Time - Ask: "What time would you prefer?" (use 24-hour format HH:MM)
   6. ✅ Number of guests - Look for "3 guests", "party of 4", ask: "How many guests?"
   
   OPTIONAL INFORMATION (nice to have but not required):
   - Occasion: "Is this for a special occasion?"
   - Area preference: "Do you have a seating preference?"
   
   🚨 CRITICAL RULES - READ CAREFULLY:
   - DO NOT say "Done!" or "All set!" until you call create_reservation tool
   - DO NOT skip information collection - you need all 6 required items
   - DO NOT make assumptions - if customer didn't provide info, ASK for it
   - DO NOT create reservation without email - it's REQUIRED
   - Review conversation history FIRST - customer may have already provided info
   - If customer said "Abraham, abkanyanta@gmail.com, 3 guests" in one message → you have name, email, guests
   
   🔍 AFTER CUSTOMER PROVIDES INFORMATION - MANDATORY CHECK:
    When customer responds with name, email, or guest count:
    1. PAUSE - Do NOT send any reply yet
    2. REVIEW conversation - Extract all 6 required fields:
       - Name: Look for "I'm X", "My name is X", "X here", or name in latest message
       - Email: Look for pattern with @ symbol
       - Guests: Look for numbers like "3 guests", "5 people", "party of 4"
       - Phone: ALWAYS available (${conversation.phone})
       - Date: From previous get_date_info tool result or conversation
       - Time: From previous conversation or calendar check
    3. COUNT how many of 6 items you have
    4. If count === 6 → IMMEDIATELY call create_reservation (DO NOT send text reply first)
    5. If count < 6 → Send reply asking ONLY for missing items

    EXAMPLE - Customer says "Abraham, abraham@email.com, 5 guests":
    ✅ Extracted: name=Abraham, email=abraham@email.com, guests=5
    ✅ Already have: phone, date, time
    ✅ Count: 6/6 → CALL create_reservation tool immediately
    ❌ Do NOT say "Got it!" or "I processed your request" without calling the tool
    
    STEP 4 - CREATE RESERVATION:
    Once you have all 6 required items, IMMEDIATELY call create_reservation tool.
    DO NOT ask "Should I book this?" - just create it.
    
    STEP 5 - CONFIRM TO CUSTOMER:
    After create_reservation tool executes, explain:
    "Perfect! Your reservation request for [DATE] at [TIME] for [GUESTS] guests has been received.
    Our team will review and send confirmation within a few hours. Thank you! 🙏"
   
   🔔 BOSS NOTIFICATION (AUTOMATIC):
   - The create_reservation tool AUTOMATICALLY notifies the boss
   - You do NOT need to call notify_boss separately for new reservations
   - Boss receives: date, time, guests, customer details, and approval options
   
   ALL RESERVATIONS REQUIRE BOSS CONFIRMATION:
   - Make this clear to customers: "Your request will be reviewed by our team"
   - Status starts as pending_boss_approval
4. For payments and purchases, use the AUTONOMOUS CHECKOUT flow: check_stock → record_sale → generate_payment_link. NEVER escalate standard purchases to the boss.
5. 🚨 DIGITAL PRODUCT DELIVERY - CRITICAL PRIORITY 🚨:
   When customer sends payment proof (screenshot/image showing payment):
   
   IMMEDIATE ACTION REQUIRED - DO NOT DELAY:
   a) Image analysis will detect payment proof and extract: amount, reference, provider
   b) You will see pending transactions listed in the context
   c) Compare the detected amount with pending transaction amounts
   d) If amounts match (within 10%), you MUST call deliver_digital_product tool IMMEDIATELY
   
   ⚠️ YOU MUST USE THE TOOL - DO NOT:
   - Say "I'll forward this to management"
   - Ask the boss to send the product manually
   - Tell customer to wait for manual verification
   - Acknowledge receipt without delivering
   
   ✅ YOU MUST:
   - Call deliver_digital_product(product_name: "exact product name", reason: "Payment verified - K250 MTN")
   - Confirm delivery to customer after tool succeeds
   
   EXAMPLE FLOW:
   Customer sends MTN screenshot showing K250 → Context shows pending transaction "ABC's for Christians - ZMW 250"
   → Call: deliver_digital_product(product_name: "ABC's for Christians", reason: "Payment proof verified - K250 MTN transfer")
   → Product is automatically sent to customer via WhatsApp
6. CRITICAL: NEVER invent or guess media URLs. ALWAYS call search_media first, then use the exact URLs it returns in send_media. When customers ask for samples/photos/videos, call search_media first then send_media with the returned URLs
7. KEEP RESPONSES SHORT AND CONCISE:
   - Simple questions (greetings, yes/no, basic info): 1-3 sentences maximum
   - Only provide detailed explanations when customer explicitly asks or for complex topics
   - Use bullet points for lists instead of long paragraphs
   - Get straight to the point
   - NEVER use markdown tables (no pipe symbols, no dashed separators). WhatsApp does NOT render tables — they appear as broken raw text on mobile.
   - For multi-item data (stock levels, price lists, comparisons), use this WhatsApp-native format: one item per line, bold the name with *asterisks*, separate name from data with an em-dash or colon.
     Example for stock:
     *LSC* — 90 in stock @ K8,600
     *LSF 2.0* — 45 in stock @ K12,000
     *LSMax* — 12 in stock @ K18,500
8. If you don't know something, admit it politely
9. Never make up information not provided above
10. CRITICAL: When sending media, do NOT say you'll send it - just call send_media immediately
11. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.
12. CRITICAL - NO REPETITIVE QUESTIONS:
    - Before asking ANY question, check if the answer is in conversation history
    - If customer already provided partial information, acknowledge it and only ask for missing pieces
    - Example: If customer said "Abraham, 3 guests", respond with:
      "Perfect! I have Abraham and 3 guests. I just need your email address to complete the booking."
    - NEVER ask for the same information twice
    - If unsure, send the flow with whatever info you have in prefill_data - the form handles the rest
13. NEVER REPEAT YOUR GREETING:
    - If you already greeted the customer in this conversation, do NOT greet again
    - Check conversation history — if you see your own "Welcome" or greeting message, skip the greeting
    - Jump straight to answering the customer's current question

PRODUCT PURCHASES:
When a customer wants to BUY or PURCHASE a product:
1. Use the request_payment tool with the product name
2. The tool will look up the correct price and create a transaction
3. Payment instructions with mobile money numbers will be sent automatically
4. Do NOT trigger handoff for product purchases - the tool handles everything
Examples: "I want the ebook", "How do I buy ABC for Christians", "Can I purchase", "I want to order", "How much is the book"

AUTOMATIC NOTIFICATION DETECTION:
When you detect these scenarios, call notify_boss tool immediately:
- High-value opportunity: 10+ guests, "corporate", "business event", "conference"
- Reservation cancellation: "cancel my booking", "need to cancel"
- Reservation change request: "change my reservation", "different time"
- Complaint/negative sentiment: "disappointed", "unhappy", "terrible", "worst", "angry"
- VIP/important info: Customer mentions being a regular, celebrity, VIP treatment needed

CRITICAL HANDOFF PROTOCOL:
- Only append [HANDOFF_REQUIRED] for COMPLEX issues requiring human judgment
- Do NOT use handoff for normal purchases - use request_payment tool instead
- Examples requiring handoff:
  * "I have a technical issue with..."
  * Questions about custom requests, refunds, complaints requiring human judgment
  * Already paid but having access issues
- IMPORTANT: The customer will NOT see the [HANDOFF_REQUIRED] tag - it's for internal system use only
- Continue to provide a helpful response to the customer, then add the tag`;


    // Build conversation history with proper user/assistant roles
    const transcriptLines = conversation.transcript.split('\n').filter((line: string) => line.trim());
    const parsedMessages: Array<{ role: string; content: string }> = [];

    for (const line of transcriptLines) {
      const customerMatch = line.match(/^Customer:\s*(.+)/i);
      const assistantMatch = line.match(/^Assistant:\s*(.+)/i);
      if (customerMatch) {
        parsedMessages.push({ role: 'user', content: customerMatch[1] });
      } else if (assistantMatch) {
        parsedMessages.push({ role: 'assistant', content: assistantMatch[1] });
      }
    }

    // Take last N messages based on complexity: 8 for simple, 12 for complex
    const historyWindow = messageComplexity === 'simple' ? -8 : -12;
    const recentMessages = parsedMessages.slice(historyWindow);

    const messages = [
      { role: 'system', content: instructions },
      ...recentMessages,
    ];

    // Add current user message + image context (avoid duplicating if transcript already contains it)
    // Also inject pending-action context so the agent knows what a bare "yes" refers to.
    const pendingActionHint = pendingAction ? `\n\n${describePendingActionForAgent(pendingAction)}` : '';
    const fullUserMessage = imageAnalysisContext 
      ? `${userMessage}\n\n[IMAGE ANALYSIS CONTEXT]:${imageAnalysisContext}${pendingActionHint}` 
      : `${userMessage}${pendingActionHint}`;

    const lastParsed = recentMessages[recentMessages.length - 1];
    if (!lastParsed || lastParsed.role !== 'user' || lastParsed.content !== userMessage) {
      messages.push({ role: 'user', content: fullUserMessage });
    }

    // ========== SUPERVISOR AGENT LAYER ==========
    // Call supervisor ONLY for complex queries
    let supervisorRecommendation = null;
    
    if (messageComplexity === 'complex') {
      console.log('[SUPERVISOR] Requesting strategic analysis for complex query...');
      
      try {
        const supervisorResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/supervisor-agent`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              companyId: company.id,
              customerPhone,
              customerMessage: userMessage,
              conversationHistory: transcriptLines.slice(-20),
              companyData: company,
              customerData: conversation
            })
          }
        );

        if (supervisorResponse.ok) {
          const supervisorData = await supervisorResponse.json();
          if (supervisorData.success) {
            supervisorRecommendation = supervisorData.recommendation;
            console.log('[SUPERVISOR] Strategic guidance received');
            console.log('[SUPERVISOR] Strategy:', supervisorRecommendation.strategy);
          }
        } else {
          console.log('[SUPERVISOR] Supervisor unavailable, proceeding without guidance');
        }
      } catch (error) {
        console.error('[SUPERVISOR] Supervisor failed, proceeding without guidance:', error);
      }
    } else {
      console.log('[SUPERVISOR] Skipping supervisor for simple query - responding quickly');
    }

    // Enhance instructions with supervisor guidance if available
    if (supervisorRecommendation) {
      instructions += `\n\n=== STRATEGIC SUPERVISOR GUIDANCE ===
Your supervisor has analyzed this interaction and provided strategic recommendations:

ANALYSIS: ${supervisorRecommendation.analysis}

RECOMMENDED STRATEGY: ${supervisorRecommendation.strategy}

KEY POINTS TO ADDRESS:
${supervisorRecommendation.keyPoints.map((point: string, i: number) => `${i + 1}. ${point}`).join('\n')}

TONE GUIDANCE: ${supervisorRecommendation.toneGuidance}

CONVERSION TIPS:
${supervisorRecommendation.conversionTips.map((tip: string, i: number) => `${i + 1}. ${tip}`).join('\n')}

AVOID:
${supervisorRecommendation.avoidances.map((avoid: string, i: number) => `${i + 1}. ${avoid}`).join('\n')}

RECOMMENDED APPROACH:
${supervisorRecommendation.recommendedResponse}

⚠️ CRITICAL: Use this strategic guidance to craft your response. The customer should only see your final response - never mention the supervisor or internal analysis.`;
      
      // Update messages array with enhanced instructions
      messages[0] = { role: 'system', content: instructions };
    }
    // Update system message with supervisor guidance
    messages[0] = { role: 'system', content: instructions };

    // ========== DYNAMIC AI CONFIGURATION FROM DATABASE ==========
    // Use AI overrides from company_ai_overrides table instead of hardcoded values
    const primaryModel = aiOverrides?.primary_model || 'glm-4.7';
    
    // Select model based on complexity
    const selectedModel = messageComplexity === 'simple' ? 'glm-4.7' : primaryModel;
    const configuredMaxTokens = aiOverrides?.max_tokens || 1024;
    const maxTokens = messageComplexity === 'simple' ? Math.min(512, configuredMaxTokens) : configuredMaxTokens;
    const temperature = aiOverrides?.primary_temperature || 1.0;
    const responseTimeout = (aiOverrides?.response_timeout_seconds || 60) * 1000;
    const fallbackMessage = aiOverrides?.fallback_message || "Thank you for your message. I'm looking into that for you - someone will respond shortly. 🙏";
    
    console.log(`[AI-CONFIG] Using database configuration:`, {
      primaryModel,
      selectedModel,
      maxTokens,
      temperature,
      responseTimeout: responseTimeout / 1000 + 's',
      hasFallbackMessage: !!aiOverrides?.fallback_message
    });

    // ========== TOOL DEFINITIONS ==========
    // Define all available tools in a map for filtering
    const allToolDefinitions: Record<string, any> = {
      create_reservation: {
        type: "function",
        function: {
          name: "create_reservation",
          description: "Create a new reservation in the database with pending_boss_approval status. Use this IMMEDIATELY after you have collected: name, phone, email, date, time, guests. Extract information from conversation history before calling this.",
          parameters: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Customer's full name extracted from conversation" },
              phone: { type: "string", description: "Customer's phone number (WhatsApp number always available)" },
              email: { type: "string", description: "Customer's email address" },
              date: { type: "string", description: "Reservation date (YYYY-MM-DD)" },
              time: { type: "string", description: "Reservation time (HH:MM format, 24-hour)" },
              guests: { type: "number", description: "Number of guests" },
              occasion: { type: "string", description: "Special occasion (optional)" },
              area_preference: { type: "string", description: "Seating area preference (optional)" }
            },
            required: ["customer_name", "phone", "email", "date", "time", "guests"]
          }
        }
      },
      get_date_info: {
        type: "function",
        function: {
          name: "get_date_info",
          description: "Get information about dates. Use this to convert relative dates like 'tomorrow', 'next Monday', 'this weekend' into actual YYYY-MM-DD format, or to validate if a date is in the future.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Date query like 'tomorrow', 'next Monday', 'this Friday', or specific date to validate like '2025-11-20'" }
            },
            required: ["query"]
          }
        }
      },
      notify_boss: {
        type: "function",
        function: {
          name: "notify_boss",
          description: "Send an immediate notification to the boss. Use for: purchase handoff (customer wants to buy in human-in-loop mode), customer issues/complaints, order follow-ups, high-value opportunities, reservation changes, VIP info.",
          parameters: {
            type: "object",
            properties: {
              notification_type: { type: "string", enum: ["purchase_handoff", "customer_issue", "order_followup", "high_value", "complaint", "reservation_change", "cancellation", "vip_info"] },
              priority: { type: "string", enum: ["high", "urgent"] },
              summary: { type: "string", description: "Brief summary of the situation (include product, quantity, customer name/phone for purchase_handoff)" },
              details: { type: "string", description: "Additional context" }
            },
            required: ["notification_type", "priority", "summary"]
          }
        }
      },
      send_media: {
        type: "function",
        function: {
          name: "send_media",
          description: "Send media files to customer via WhatsApp. IMPORTANT: You MUST call search_media first to get valid URLs. Never fabricate or guess URLs. Use the exact URLs returned by search_media.",
          parameters: {
            type: "object",
            properties: {
              media_urls: { type: "array", items: { type: "string" }, description: "Array of media file URLs from the library" },
              caption: { type: "string", description: "Caption for the media" },
              category: { type: "string", description: "Category of media" }
            },
            required: ["media_urls", "category"]
          }
        }
      },
      check_calendar_availability: {
        type: "function",
        function: {
          name: "check_calendar_availability",
          description: "Check reservation database for scheduling conflicts. Always call BEFORE creating a reservation.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
              time: { type: "string", description: "Time in HH:MM format" },
              duration_minutes: { type: "number", description: "Expected duration in minutes (default 120)" }
            },
            required: ["date", "time"]
          }
        }
      },
      create_calendar_event: {
        type: "function",
        function: {
          name: "create_calendar_event",
          description: "Notify boss about pending reservation for approval.",
          parameters: {
            type: "object",
            properties: {
              reservation_id: { type: "string", description: "Reservation UUID from database" },
              title: { type: "string", description: "Reservation title" },
              description: { type: "string", description: "Additional reservation details" },
              send_notifications: { type: "boolean", description: "Deprecated - kept for compatibility" }
            },
            required: ["reservation_id", "title"]
          }
        }
      },
      request_payment: {
        type: "function",
        function: {
          name: "request_payment",
          description: `Use ONLY when customer EXPLICITLY says they want to BUY, PURCHASE, or ORDER a specific product.
CRITICAL: Only for explicit purchase intent like "I want to buy", "I'll take the...", "Can I order"
DO NOT USE for: fee inquiries, pricing questions, general info requests.`,
          parameters: {
            type: "object",
            properties: {
              product_id: { type: "string", description: "Product UUID if known" },
              product_name: { type: "string", description: "Name of the product customer wants to buy" },
              amount: { type: "number", description: "Product price if known" },
              payment_method: { type: "string", description: "Preferred payment method if mentioned" },
              customer_details: {
                type: "object",
                properties: { name: { type: "string" }, email: { type: "string" } }
              }
            },
            required: ["product_name"]
          }
        }
      },
      deliver_digital_product: {
        type: "function",
        function: {
          name: "deliver_digital_product",
          description: "Deliver a digital product to a customer after payment has been verified. Use when customer sends payment proof and payment matches a pending transaction.",
          parameters: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "Name of the product to deliver" },
              reason: { type: "string", description: "Brief reason for delivery (e.g., 'Payment proof verified - K250 MTN transfer')" }
            },
            required: ["product_name", "reason"]
          }
        }
      },
      create_support_ticket: {
        type: "function",
        function: {
          name: "create_support_ticket",
          description: "Creates a support ticket ONLY when a customer explicitly requests human assistance, reports a genuine problem/complaint, or needs help that the AI truly cannot provide. NEVER create tickets for: product availability questions (just say it's not in stock), pricing inquiries, general questions, or anything the AI can answer directly. ALWAYS collect the customer's name and a clear description of their issue BEFORE calling this tool.",
          parameters: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Customer's full name collected from conversation" },
              issue_summary: { type: "string", description: "Clear, concise description of the customer's issue" },
              issue_category: { type: "string", enum: ["billing", "technical", "account", "product", "general", "complaint", "feature_request"], description: "Category of the issue" },
              priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority level based on urgency and impact" },
              recommended_department: { type: "string", description: "AI recommendation for which department should handle this" },
              recommended_employee: { type: "string", description: "Specific employee name if known from company departments" },
              service_recommendations: { type: "array", items: { type: "string" }, description: "Array of suggested services or solutions for the customer" }
            },
            required: ["customer_name", "issue_summary", "issue_category", "priority"]
          }
        }
      },
      recommend_services: {
        type: "function",
        function: {
          name: "recommend_services",
          description: "Search company products, knowledge base, and documents to find relevant services or solutions for a customer's issue. Use proactively when a customer describes a problem to suggest helpful resources.",
          parameters: {
            type: "object",
            properties: {
              issue_description: { type: "string", description: "Description of what the customer needs help with" },
              category: { type: "string", description: "Optional category filter for products/services" }
            },
            required: ["issue_description"]
          }
        }
      },
      lookup_product: {
        type: "function",
        function: {
          name: "lookup_product",
          description: "Search for products/items in the company's catalog by name, keyword, category, or description. Use when a customer asks about a specific product, wants recommendations, or you need product details like price and description.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query - product name, keyword, or category to look up" },
              category: { type: "string", description: "Optional category filter" }
            },
            required: ["query"]
          }
        }
      },
      list_products: {
        type: "function",
        function: {
          name: "list_products",
          description: "Lists all available products/items in the business catalog from the BMS. Use when a customer asks 'what do you sell?', 'show me your products', 'what's available?', or wants to browse the full catalog. Returns product names, prices (unit_price field), and stock levels (current_stock field).",
          parameters: {
            type: "object",
            properties: {
              category: { type: "string", description: "Optional category filter to narrow results" }
            },
            required: []
          }
        }
      },
      check_stock: {
        type: "function",
        function: {
          name: "check_stock",
          description: "Checks real-time inventory levels and pricing for a specific product in the BMS. Returns current_stock (quantity available) and unit_price (price per unit).",
          parameters: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "The name of the product the user is asking about" }
            },
            required: ["product_name"]
          }
        }
      },
      record_sale: {
        type: "function",
        function: {
          name: "record_sale",
          description: "Records a completed sale in the BMS after the customer has confirmed their order.",
          parameters: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "The name of the product being sold" },
              quantity: { type: "integer", description: "The number of items being purchased" },
              payment_method: { type: "string", description: "How the customer is paying", enum: ["cash", "mobile_money", "bank_transfer", "card"] },
              customer_name: { type: "string", description: "The name of the customer, if known" },
              customer_phone: { type: "string", description: "The phone number of the customer, if known" }
            },
            required: ["product_name", "quantity", "payment_method"]
          }
        }
      },
      generate_payment_link: {
        type: "function",
        function: {
          name: "generate_payment_link",
          description: "Generates a secure Lenco payment link for the customer to pay via Mobile Money (MTN, Airtel, Zamtel) or Card.",
          parameters: {
            type: "object",
            properties: {
              amount: { type: "number", description: "The total amount in ZMW to be paid" },
              customer_name: { type: "string", description: "The name of the customer" },
              customer_phone: { type: "string", description: "The phone number of the customer" },
              reference: { type: "string", description: "The order number, receipt number, or a unique reference string for this transaction" }
            },
            required: ["amount", "customer_name", "customer_phone", "reference"]
          }
        }
      },
      get_product_variants: {
        type: "function",
        function: {
          name: "get_product_variants",
          description: "Gets available variants (colors, sizes) for a specific product. Use when a customer asks about available colors, sizes, or options for a product.",
          parameters: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "The name of the product to get variants for" }
            },
            required: ["product_name"]
          }
        }
      },
      create_order: {
        type: "function",
        function: {
          name: "create_order",
          description: "Creates a new order for the customer with delivery. Use when a customer wants to place an order, buy products with delivery, or checkout. Collect customer name, phone, items, and delivery address before calling.",
          parameters: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Full name of the customer" },
              customer_phone: { type: "string", description: "Phone number of the customer" },
              customer_email: { type: "string", description: "Email address if provided" },
              items: { type: "array", items: { type: "object", properties: { product_name: { type: "string" }, quantity: { type: "integer" } }, required: ["product_name", "quantity"] }, description: "Array of items to order" },
              payment_method: { type: "string", description: "Payment method: cash, mobile_money, bank_transfer, card" },
              delivery_address: { type: "string", description: "Delivery address for the order" },
              notes: { type: "string", description: "Any special instructions" }
            },
            required: ["customer_name", "customer_phone", "items"]
          }
        }
      },
      get_order_status: {
        type: "function",
        function: {
          name: "get_order_status",
          description: "Checks the status of an existing order. Use when a customer asks about their order status, tracking, or delivery progress.",
          parameters: {
            type: "object",
            properties: {
              order_number: { type: "string", description: "The order number (e.g., ORD-2026-0042)" },
              order_id: { type: "string", description: "The order ID if known" }
            },
            required: []
          }
        }
      },
      cancel_order: {
        type: "function",
        function: {
          name: "cancel_order",
          description: "Cancels an existing order. Use when a customer wants to cancel their order. Confirm with the customer before calling.",
          parameters: {
            type: "object",
            properties: {
              order_number: { type: "string", description: "The order number to cancel" },
              order_id: { type: "string", description: "The order ID if known" },
              reason: { type: "string", description: "Reason for cancellation" }
            },
            required: []
          }
        }
      },
      get_customer_history: {
        type: "function",
        function: {
          name: "get_customer_history",
          description: "Retrieves purchase history for the current customer. Use when a customer asks about their previous orders, purchases, or transaction history.",
          parameters: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Customer name to look up" },
              customer_phone: { type: "string", description: "Customer phone number to look up" }
            },
            required: []
          }
        }
      },
      get_company_statistics: {
        type: "function",
        function: {
          name: "get_company_statistics",
          description: "Gets company impact and statistics. Use when a customer asks about the company's impact, how many people helped, or general company stats.",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      create_quotation: {
        type: "function",
        function: {
          name: "create_quotation",
          description: "Creates a quotation/price estimate for the customer with itemized products and prices. Use when a customer asks for a quote, estimate, or formal pricing.",
          parameters: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Name of the customer requesting the quote" },
              items: { type: "array", items: { type: "object", properties: { product_name: { type: "string" }, quantity: { type: "integer" }, unit_price: { type: "number" } }, required: ["product_name", "quantity", "unit_price"] }, description: "Array of items for the quotation" },
              notes: { type: "string", description: "Additional notes for the quotation" }
            },
            required: ["customer_name", "items"]
          }
        }
      },
      create_invoice: {
        type: "function",
        function: {
          name: "create_invoice",
          description: "Creates a formal invoice for the customer. Use after a sale is confirmed and the customer needs an invoice or receipt document.",
          parameters: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Name of the customer" },
              items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "integer" }, unit_price: { type: "number" } }, required: ["description", "quantity", "unit_price"] }, description: "Array of line items for the invoice" },
              notes: { type: "string", description: "Additional notes" },
              due_days: { type: "integer", description: "Number of days until payment is due (default 30)" }
            },
            required: ["customer_name", "items"]
          }
        }
      },
      create_contact: {
        type: "function",
        function: {
          name: "create_contact",
          description: "Submit a contact inquiry on behalf of the customer. Use when a customer wants to leave a message for the business, submit a general inquiry, or send feedback via the contact form.",
          parameters: {
            type: "object",
            properties: {
              sender_name: { type: "string", description: "Name of the person submitting the inquiry" },
              sender_email: { type: "string", description: "Email address of the person" },
              message: { type: "string", description: "The inquiry or feedback message" },
              sender_phone: { type: "string", description: "Phone number if provided" }
            },
            required: ["sender_name", "sender_email", "message"]
          }
        }
      },
      search_media: {
        type: "function",
        function: {
          name: "search_media",
          description: "Semantically search the company's media library (photos AND videos) to find the most relevant files to share with the customer. Use instead of guessing URLs. Returns the top matching media with URLs and a media_type field ('image' or 'video'). When the customer specifically asks for a video/clip/reel, set media_type='video' to filter to videos only.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "What the customer is looking for — product name, category, or description" },
              media_type: { type: "string", enum: ["image", "video"], description: "Optional filter: only return images or only videos. Use 'video' when customer asks for a video/clip/reel/footage." },
              count: { type: "integer", description: "Max results to return (default 5)" }
            },
            required: ["query"]
          }
        }
      },
      search_knowledge: {
        type: "function",
        function: {
          name: "search_knowledge",
          description: "Search the company's knowledge base documents for relevant information. Use when a customer asks about policies, procedures, detailed product info, or anything that might be in uploaded documents.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The question or topic to search for" }
            },
            required: ["query"]
          }
        }
      },
      search_past_conversations: {
        type: "function",
        function: {
          name: "search_past_conversations",
          description: "Search past conversations with this customer or similar topics. Use when a returning customer references a previous interaction, or when you need context from prior discussions.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "What to search for in past conversations" },
              customer_phone: { type: "string", description: "Optional: filter to a specific customer's conversations" }
            },
            required: ["query"]
          }
        }
      }
    };

    // ========== TOOL FILTERING BY BUSINESS TYPE AND ENABLED_TOOLS ==========
    // Determine which tools to include based on business type and database configuration
    let enabledToolNames: string[] = aiOverrides?.enabled_tools || Object.keys(allToolDefinitions);

    // Per-company sales mode (default 'autonomous'). 'human_in_loop' = AI hands off
    // buy intent to the boss instead of closing the sale itself.
    const salesMode: 'autonomous' | 'human_in_loop' =
      (company.metadata as any)?.sales_mode === 'human_in_loop' ? 'human_in_loop' : 'autonomous';
    console.log(`[SALES-MODE] Company ${company.id} sales_mode=${salesMode}`);

    // Auto-merge mandatory checkout tools for non-school, payment-enabled, autonomous companies
    if (!isSchool && !company.payments_disabled && salesMode === 'autonomous') {
      const mandatoryCheckoutTools = ['check_stock', 'record_sale', 'credit_sale', 'generate_payment_link', 'lookup_product', 'list_products', 'get_product_variants', 'create_order', 'get_order_status', 'cancel_order', 'get_customer_history', 'get_company_statistics', 'create_quotation', 'create_invoice', 'check_customer', 'who_owes', 'pending_orders'];
      for (const tool of mandatoryCheckoutTools) {
        if (!enabledToolNames.includes(tool)) {
          enabledToolNames.push(tool);
        }
      }
      console.log('[TOOLS] Auto-merged mandatory checkout tools into enabled set');
    } else if (salesMode === 'human_in_loop') {
      // Strip checkout-closing tools so the AI cannot close sales itself
      const closingTools = ['record_sale', 'credit_sale', 'generate_payment_link', 'create_order', 'create_invoice', 'check_customer'];
      enabledToolNames = enabledToolNames.filter(t => !closingTools.includes(t));
      console.log('[TOOLS] Human-in-loop mode — stripped closing tools:', closingTools);
    }
    
    // Business-type-based tool restrictions
    if (isSchool) {
      // Schools should NOT have payment/product tools
      const schoolExcludedTools = ['request_payment', 'deliver_digital_product', 'check_stock', 'record_sale', 'generate_payment_link'];
      enabledToolNames = enabledToolNames.filter(t => !schoolExcludedTools.includes(t));
      console.log('[TOOLS] School business - excluded payment tools:', schoolExcludedTools);
    }

    // Companies with payments disabled (sell on external websites)
    if (company.payments_disabled) {
      const paymentTools = ['request_payment', 'deliver_digital_product', 'lookup_product', 'check_stock', 'record_sale', 'generate_payment_link'];
      enabledToolNames = enabledToolNames.filter(t => !paymentTools.includes(t));
      console.log('[TOOLS] Payments disabled for company - excluded payment tools:', paymentTools);
    }

    // Auto-merge core search & notification tools — these are always safe and required
    const alwaysEnabledTools = ['search_media', 'search_knowledge', 'search_past_conversations', 'notify_boss'];
    for (const tool of alwaysEnabledTools) {
      if (!enabledToolNames.includes(tool)) {
        enabledToolNames.push(tool);
      }
    }
    console.log('[TOOLS] Auto-merged always-enabled tools:', alwaysEnabledTools);

    // Filter tools array based on enabled tools
    const filteredTools = enabledToolNames
      .filter(toolName => allToolDefinitions[toolName])
      .map(toolName => allToolDefinitions[toolName]);
    
    console.log('[TOOLS] Enabled tools for this company:', enabledToolNames);
    console.log('[TOOLS] Filtered tools count:', filteredTools.length);

    // ========== ADD TOOL AVAILABILITY TO SYSTEM PROMPT ==========
    // Tell the AI explicitly which tools it has access to
    const toolAvailabilitySection = `

=== YOUR AVAILABLE TOOLS ===
You have access to these tools ONLY:
${enabledToolNames.map(t => `- ${t}`).join('\n')}

CRITICAL TOOL USAGE RULES:
1. Only use tools from the list above - do NOT attempt to use any other tools
2. If a customer request would require a tool you don't have, provide information conversationally instead
3. Never hallucinate tool capabilities - stick to what's available
${isSchool ? '\n⚠️ SCHOOL BUSINESS: You do NOT have payment processing tools. For fees and payments, provide information from your knowledge base and direct parents to visit the school office.' : ''}
`;

    // Append tool availability to instructions
    instructions += toolAvailabilitySection;

    // ========== CRITICAL: CURRENT INSTRUCTIONS OVERRIDE HISTORY ==========
    // This directive ensures AI uses current knowledge base, not patterns from old conversations
    instructions += `

=== CRITICAL: CURRENT INSTRUCTIONS OVERRIDE HISTORY ===
Your behavior is defined by THIS system prompt ONLY. This is the authoritative source of truth.

⚠️ IMPORTANT DATA FRESHNESS RULES:
1. The conversation history shows what WAS said, NOT what SHOULD be said now
2. If you see old response patterns that contradict your current instructions → IGNORE the old patterns
3. Company policies, fees, products, and procedures in your KNOWLEDGE BASE above are the ONLY source of truth
4. NEVER replicate old response formats if they violate your current business type rules
5. If past messages show a different business workflow, that information may be OUTDATED

Example: If conversation history shows payment transaction responses, but you are a SCHOOL with no payment tools → do NOT generate payment responses. Provide information from your knowledge base instead.

=== AUTHORITATIVE INFORMATION SOURCES (Priority Order) ===
When answering questions about products, stock, pricing, orders, or any transactional data:
1. BMS TOOLS (HIGHEST PRIORITY - real-time business data): ALWAYS use check_stock, get_product_variants, get_order_status, get_customer_history, or other BMS tools FIRST to get live, accurate data before responding. Never guess prices or stock levels.
2. KNOWLEDGE BASE sections above (company policies, FAQs, static info)
3. BUSINESS INFORMATION section (company details, hours, location)
4. CUSTOM SYSTEM INSTRUCTIONS section
5. AI OVERRIDES sections

⚡ BMS-FIRST RULE: If a customer asks about a product, price, availability, order, or anything the BMS can answer — ALWAYS call the relevant BMS tool first. Only fall back to the knowledge base if the BMS tool returns no data or the question is about policies/procedures rather than transactional data.

DO NOT use:
- Patterns or responses from conversation history (except customer-provided info like their name/email)
- Assumptions based on how similar businesses operate
- Made-up prices, policies, or procedures not in your knowledge base

If information is NOT in your authoritative sources above, say: "I don't have that specific information. Please contact ${company.phone || 'us directly'} for details."

=== KNOWLEDGE FRESHNESS INDICATOR ===
Your knowledge base was last updated: ${company.updated_at ? new Date(company.updated_at).toISOString() : 'recently'}
Trust ONLY the information provided in this system prompt.
`;
    
    // Update the messages array with final instructions
    messages[0] = { role: 'system', content: instructions };

    // Call Lovable AI Gateway with configurable timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), responseTimeout);
    
    let assistantReply = '';
    let anyToolExecuted = false;
    let toolExecutionContext: string[] = [];
    let toolResults: Array<{tool_call_id: string, role: string, content: string}> = [];
    // Cumulative buffer of EVERY tool result across all rounds — used by the final synthesis fallback
    // so earlier-round product/media payloads aren't lost when toolResults is reset per round.
    const allToolResults: Array<{tool_call_id: string, role: string, content: string, fn?: string}> = [];
    let aiData: any = null; // Store AI response for tool loop

    try {
      const response = await geminiChatWithFallback({
        model: selectedModel,
        messages: sanitizeMessages(messages),
        temperature,
        max_tokens: maxTokens,
        tools: filteredTools,
        tool_choice: "auto",
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[BACKGROUND] Gemini API error:', response.status, errorText);
        throw new Error(`Gemini API error: ${response.status}`);
      }

      aiData = await response.json();
      assistantReply = aiData.choices[0].message.content || '';
      const toolCalls = aiData.choices[0].message.tool_calls;

      if (!assistantReply && (!toolCalls || toolCalls.length === 0)) {
        console.warn('[AI-RESPONSE] Model returned empty content and no tool calls for message:', userMessage?.substring(0, 100));
      }

      // Enhanced logging for AI decision making
      console.log('[AI-TOOLS] Response from AI:', {
        hasReply: !!assistantReply,
        replyPreview: assistantReply?.substring(0, 150) + (assistantReply?.length > 150 ? '...' : ''),
        hasToolCalls: !!aiData.choices[0].message.tool_calls,
        toolCount: aiData.choices[0].message.tool_calls?.length || 0,
        toolNames: aiData.choices[0].message.tool_calls?.map((t: any) => t.function.name) || []
      });
      
      console.log('[BACKGROUND] AI response:', { assistantReply, toolCalls });

      // Handle tool calls
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (toolCall.function.name === 'request_payment') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[PAYMENT] Processing payment request:', args);
            
            try {
              // ========== BUSINESS TYPE CHECK ==========
              // Check if this is a school/education business - don't process as digital product
              const businessType = (company.business_type || '').toLowerCase();
              const isSchool = businessType.includes('school') || 
                               businessType.includes('education') || 
                               businessType.includes('institution') ||
                               businessType.includes('academy') ||
                               businessType.includes('college') ||
                               businessType.includes('university');
              
              if (isSchool) {
                console.log('[PAYMENT] Business is school/education - providing info instead of payment transaction');
                anyToolExecuted = true;
                toolExecutionContext.push('school business - provided fee information instead of payment transaction');
                
                // Extract fee info from knowledge base if available
                const feeInfo = company.quick_reference_info || '';
                const hasPaymentInstructions = company.payment_instructions && company.payment_instructions.trim().length > 0;
                
                if (hasPaymentInstructions) {
                  assistantReply = `Here's the information you requested:\n\n${company.payment_instructions}\n\nFor enrollment and fee payments, please visit our school office where our staff will assist you with the registration process. 🏫`;
                } else {
                  assistantReply = `Thank you for your interest! For detailed fee information and enrollment, please visit our school office or contact us directly. Our staff will be happy to assist you with the registration process and payment details. 🏫`;
                }
                
                // Store tool result for AI context
                toolResults.push({
                  tool_call_id: toolCall.id,
                  role: "tool",
                  content: JSON.stringify({
                    success: true,
                    business_type: 'school',
                    action: 'provided_info_only',
                    message: 'School business - provided fee information. No payment transaction created.'
                  })
                });
                
                continue; // Skip rest of payment processing
              }
              
              // ========== CHECK FOR PAYMENT PRODUCTS ==========
              // Verify company has payment products configured
              const { data: availableProducts, error: productsError } = await supabase
                .from('payment_products')
                .select('id, name, price, currency')
                .eq('company_id', company.id)
                .eq('is_active', true)
                .limit(5);
              
              const hasPaymentProducts = availableProducts && availableProducts.length > 0;
              const hasPaymentNumbers = company.payment_number_mtn || company.payment_number_airtel || company.payment_number_zamtel;
              
              if (!hasPaymentProducts && !hasPaymentNumbers) {
                console.log('[PAYMENT] Company has no payment products or mobile money configured');
                anyToolExecuted = true;
                toolExecutionContext.push('no payment products configured - provided contact info');
                
                assistantReply = `Thank you for your interest! For pricing and payment details, please contact us directly or visit our location. We'll be happy to assist you with your purchase. 🙏`;
                
                toolResults.push({
                  tool_call_id: toolCall.id,
                  role: "tool",
                  content: JSON.stringify({
                    success: false,
                    reason: 'no_payment_config',
                    message: 'Company has no payment products or mobile money numbers configured'
                  })
                });
                
                continue; // Skip rest of payment processing
              }
              
              // ========== STANDARD PAYMENT PROCESSING ==========
              // Look up product from database to get accurate details
              let productId = args.product_id;
              let productName = args.product_name;
              let amount = args.amount;
              let currency = company.currency_prefix || 'ZMW';
              let productType = 'service';
              
              // Search for product by name if product_id not provided or invalid
              if (!productId || productId === 'unknown') {
                const { data: foundProduct } = await supabase
                  .from('payment_products')
                  .select('*')
                  .eq('company_id', company.id)
                  .eq('is_active', true)
                  .ilike('name', `%${productName}%`)
                  .maybeSingle();
                
                if (foundProduct) {
                  productId = foundProduct.id;
                  productName = foundProduct.name;
                  amount = foundProduct.price;
                  currency = foundProduct.currency || currency;
                  productType = foundProduct.product_type || 'service';
                  console.log('[PAYMENT] Found matching product:', foundProduct.name, foundProduct.price);
                } else if (!hasPaymentProducts) {
                  // No product found and no products configured
                  console.log('[PAYMENT] Product not found and no products configured');
                  anyToolExecuted = true;
                  toolExecutionContext.push('product not found - provided contact info');
                  
                  assistantReply = `I couldn't find "${productName}" in our product catalog. Please contact us directly for pricing and availability. We'll be happy to help! 🙏`;
                  
                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: JSON.stringify({
                      success: false,
                      reason: 'product_not_found',
                      searched_for: productName,
                      message: 'Product not found in catalog'
                    })
                  });
                  
                  continue;
                }
              }
              
              // Create pending transaction in database
              const { data: transaction, error: txError } = await supabase
                .from('payment_transactions')
                .insert({
                  company_id: company.id,
                  conversation_id: conversationId,
                  product_id: productId && productId !== 'unknown' ? productId : null,
                  customer_phone: customerPhone,
                  customer_name: conversation.customer_name || args.customer_details?.name || 'Customer',
                  amount: amount,
                  currency: currency,
                  payment_method: args.payment_method || null,
                  payment_status: 'pending',
                  verification_status: 'pending',
                  metadata: {
                    product_name: productName,
                    product_type: productType,
                    requested_via: 'ai_assistant'
                  }
                })
                .select()
                .single();
              
              if (txError) {
                console.error('[PAYMENT] Failed to create transaction:', txError);
              } else {
                console.log('[PAYMENT] Created pending transaction:', transaction.id);
              }
              
              // Notify management
              await supabase.functions.invoke('send-boss-notification', {
                body: {
                  companyId: company.id,
                  notificationType: 'payment_request',
                  data: {
                    customer_name: conversation.customer_name || args.customer_details?.name || 'Unknown',
                    customer_phone: `whatsapp:${customerPhone}`,
                    customer_email: args.customer_details?.email,
                    product_name: productName,
                    amount: amount,
                    currency_prefix: currency,
                    payment_method: args.payment_method,
                    transaction_id: transaction?.id
                  }
                }
              });
              
              // Build payment instructions
              const paymentNumbers = [];
              if (company.payment_number_mtn) paymentNumbers.push(`MTN: ${company.payment_number_mtn}`);
              if (company.payment_number_airtel) paymentNumbers.push(`Airtel: ${company.payment_number_airtel}`);
              if (company.payment_number_zamtel) paymentNumbers.push(`Zamtel: ${company.payment_number_zamtel}`);
              
              const paymentInstructions = paymentNumbers.length > 0 
                ? `\n\n📱 *Payment Numbers:*\n${paymentNumbers.join('\n')}`
                : '';
              
              const customInstructions = company.payment_instructions 
                ? `\n\n${company.payment_instructions}`
                : '\n\nPlease send a screenshot of your payment confirmation for verification.';
              
              anyToolExecuted = true;
              toolExecutionContext.push(`created payment transaction for ${productName} (${currency}${amount})`);
              
              // Store tool result for AI context
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({
                  success: true,
                  transaction_id: transaction?.id,
                  product_name: productName,
                  amount: amount,
                  currency: currency,
                  message: 'Payment transaction created and management notified'
                })
              });
              
              assistantReply = `Great choice! 🎉\n\n*${productName}*\n💰 Amount: *${currency}${amount}*${paymentInstructions}${customInstructions}\n\nOnce you've paid, please send a screenshot of your payment confirmation and I'll process your order immediately! 📸`;
            } catch (error) {
              console.error('[PAYMENT] Payment request error:', error);
              assistantReply = "I encountered an error processing your payment request. Please try again or contact us directly.";
            }
          } else if (toolCall.function.name === 'send_media') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] send_media called with:', JSON.stringify(args));
            
            const { result, textReply } = await handleSendMedia(args, company, customerPhone, conversationId, supabase);
            anyToolExecuted = true;
            if (textReply) {
              assistantReply = textReply;
            } else {
              toolExecutionContext.push(`sent ${result.sent}/${result.total} ${args.category || 'media'} file(s)`);
              if (!result.success) {
                assistantReply = "I tried to send the media but encountered an error.";
              }
            }
          } else if (toolCall.function.name === 'check_calendar_availability') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Checking database availability:', args);
            
            try {
              // Check database for conflicting reservations
              const requestedDateTime = new Date(`${args.date} ${args.time}`);
              const bufferMinutes = 120; // 2 hour buffer
              const startTime = new Date(requestedDateTime.getTime() - bufferMinutes * 60000);
              const endTime = new Date(requestedDateTime.getTime() + bufferMinutes * 60000);
              
              const { data: conflicts, error: conflictError } = await supabase
                .from('reservations')
                .select('name, time, guests, status')
                .eq('company_id', company.id)
                .eq('date', args.date)
                .in('status', ['pending_boss_approval', 'confirmed']);
              
              if (conflictError) {
                console.error('[BACKGROUND] Database check error:', conflictError);
                toolExecutionContext.push('database unavailable - proceeding without availability check');
                
                // Context-aware error handling: Check if customer already provided date/time
                const hasDateTime = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|weekend|\d{1,2}:\d{2}|am|pm|morning|afternoon|evening|noon|midnight)\b/i.test(userMessage);
                
                if (hasDateTime) {
                  // Customer already mentioned time - proceed with reservation flow
                  assistantReply = "Perfect! Let me collect your reservation details. While our calendar system is updating, " +
                    "our team will confirm availability and get back to you shortly.";
                  toolExecutionContext.push('customer provided date/time - proceed with reservation flow despite calendar error');
                } else {
                  // Customer didn't mention time yet - ask for it once
                  assistantReply = "I'd be happy to help you schedule a visit! While our calendar system is updating, " +
                    "let me record your details and our team will confirm availability shortly. " +
                    "What date and time works best for you?";
                }
                anyToolExecuted = true;
              } else {
                anyToolExecuted = true;
                const hasConflicts = conflicts && conflicts.length > 0;
                
                if (!hasConflicts) {
                  toolExecutionContext.push(`Time slot ${args.date} ${args.time} is AVAILABLE - NOW SEND RESERVATION FLOW`);
                  console.log('[BACKGROUND] Availability confirmed, automatically sending reservation flow');
                  
                  // Automatically send reservation flow after confirming availability
                  try {
                    const flowResponse = await supabase.functions.invoke('send-whatsapp-flow', {
                      body: {
                        flow_type: 'reservation',
                        header_text: '📋 Complete Your Reservation',
                        button_text: 'Fill Details',
                        prefill_data: {},
                        customer_phone: `whatsapp:${customerPhone}`,
                        company_id: company.id
                      }
                    });
                    
                    if (flowResponse.error) {
                      console.error('[BACKGROUND] Flow send error:', flowResponse.error);
                      assistantReply = `Great news! ${args.time} on ${args.date} is available. Please note that all reservations require final confirmation from our team. Please provide your name, email, and number of guests.`;
                    } else {
                      console.log('[BACKGROUND] Reservation flow sent successfully');
                      toolExecutionContext.push('sent reservation flow to customer');
                      assistantReply = `Perfect! ${args.time} on ${args.date} looks available. I've sent you a form to complete your reservation details. Please note that all reservations require final confirmation from our team. 📋`;
                    }
                  } catch (flowError) {
                    console.error('[BACKGROUND] Error sending flow:', flowError);
                    assistantReply = `Great news! ${args.time} on ${args.date} is available. Please note that reservations require team confirmation. Please provide your name, email, and number of guests.`;
                  }
                } else {
                  const conflictDetails = conflicts.map(c => `${c.time} (${c.guests} guests${c.status === 'pending_boss_approval' ? ' - pending' : ''})`).join(', ');
                  toolExecutionContext.push(`Time slot ${args.date} ${args.time} has ${conflicts.length} booking(s): ${conflictDetails}`);
                  assistantReply = `I checked our schedule and ${args.time} on ${args.date} has ${conflicts.length} booking(s) around that time. ` +
                    `Would you like to try a different time? I can suggest alternative slots for you.`;
                }
              }
            } catch (error) {
              console.error('[BACKGROUND] Calendar availability error:', error);
              toolExecutionContext.push('calendar check failed - proceeding without availability');
            }
          } else if (toolCall.function.name === 'create_calendar_event') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Notifying boss about reservation:', args);
            
            try {
              // Send boss notification instead of creating calendar event
              const { data: bossData, error: bossError } = await supabase.functions.invoke('send-boss-reservation-request', {
                body: {
                  reservationId: args.reservation_id
                }
              });
              
              if (bossError) {
                console.error('[BACKGROUND] Boss notification error:', bossError);
                toolExecutionContext.push('boss notification failed - reservation saved but boss not notified');
              } else {
                anyToolExecuted = true;
                toolExecutionContext.push('boss notified about pending reservation');
                console.log('[BACKGROUND] Boss notification sent successfully');
              }
            } catch (error) {
              console.error('[BACKGROUND] Boss notification error:', error);
              toolExecutionContext.push('boss notification failed - reservation saved but boss not notified');
            }
          } else if (toolCall.function.name === 'create_reservation') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[RESERVATION-ATTEMPT] Tool called with arguments:', JSON.stringify(args));
            
            // Validate all required fields are present
            const missingFields = [];
            if (!args.customer_name) missingFields.push('customer_name');
            if (!args.phone && !customerPhone) missingFields.push('phone');
            if (!args.email) missingFields.push('email');
            if (!args.date) missingFields.push('date');
            if (!args.time) missingFields.push('time');
            if (!args.guests) missingFields.push('guests');
            
            if (missingFields.length > 0) {
              console.error('[RESERVATION-BLOCKED] Missing required fields:', missingFields);
              toolExecutionContext.push(`reservation blocked - missing: ${missingFields.join(', ')}`);
              
              const fieldLabels: Record<string, string> = {
                customer_name: 'your name',
                phone: 'your phone number',
                email: 'your email address',
                date: 'the date',
                time: 'the time',
                guests: 'the number of guests'
              };
              
              const missingLabels = missingFields.map(f => fieldLabels[f] || f);
              assistantReply = `To complete your reservation, I still need: ${missingLabels.join(', ')}. Could you please provide these details?`;
              anyToolExecuted = true;
              continue;
            }
            
            console.log('[RESERVATION-CREATE] All required fields present, proceeding...');
            const reservationPhone = args.phone || customerPhone;
            
            try {
              // Create reservation with pending_boss_approval status
              const { data: reservation, error: resError } = await supabase
                .from('reservations')
                .insert({
                  company_id: company.id,
                  conversation_id: conversationId,
                  name: args.customer_name,
                  phone: reservationPhone,
                  email: args.email,
                  date: args.date,
                  time: args.time,
                  guests: args.guests,
                  occasion: args.occasion || null,
                  area_preference: args.area_preference || null,
                  branch: null,
                  status: 'pending_boss_approval'
                })
                .select()
                .single();

              if (resError) {
                console.error('[BACKGROUND] Reservation error:', resError);
                toolExecutionContext.push('reservation creation failed');
                
                toolResults.push({
                  tool_call_id: toolCall.id,
                  role: "tool",
                  content: JSON.stringify({
                    success: false,
                    error: 'Failed to create reservation',
                    message: 'Database error occurred. Please try again or contact support'
                  })
                });
                
                assistantReply = "I encountered an error saving your reservation. Please contact us directly.";
              } else {
                anyToolExecuted = true;
                toolExecutionContext.push(`created reservation for ${args.customer_name} - pending boss approval`);
                console.log('[BACKGROUND] Reservation created:', reservation.id);
                
                toolResults.push({
                  tool_call_id: toolCall.id,
                  role: "tool",
                  content: JSON.stringify({
                    success: true,
                    reservation_id: reservation.id,
                    customer_name: args.customer_name,
                    date: args.date,
                    time: args.time,
                    guests: args.guests,
                    status: 'pending_boss_approval',
                    message: 'Reservation created successfully and boss has been notified for approval'
                  })
                });
                
                // Update conversation with customer name
                await supabase
                  .from('conversations')
                  .update({ customer_name: args.customer_name })
                  .eq('id', conversationId);
                
                // Notify boss about new reservation request with enhanced logging
                console.log('[BOSS-NOTIFY] Attempting to notify boss about reservation:', reservation.id);
                console.log('[BOSS-NOTIFY] Boss phone:', company.boss_phone);
                console.log('[BOSS-NOTIFY] Company ID:', company.id);
                
                try {
                  const { data: bossNotifyData, error: notifyError } = await supabase.functions.invoke('send-boss-reservation-request', {
                    body: {
                      reservation_id: reservation.id,
                      company_id: company.id
                    }
                  });

                  if (notifyError) {
                    console.error('[BOSS-NOTIFY] Failed to send notification:', notifyError);
                    console.error('[BOSS-NOTIFY] Error details:', JSON.stringify(notifyError));
                  } else {
                    console.log('[BOSS-NOTIFY] ✅ Boss notification sent successfully');
                    console.log('[BOSS-NOTIFY] Response:', JSON.stringify(bossNotifyData));
                  }
                } catch (notifyError) {
                  console.error('[BOSS-NOTIFY] Exception while notifying boss:', notifyError);
                  console.error('[BOSS-NOTIFY] Exception details:', JSON.stringify(notifyError, Object.getOwnPropertyNames(notifyError)));
                }
                
                assistantReply = `Perfect! Your reservation request for ${args.date} at ${args.time} for ${args.guests} guest${args.guests > 1 ? 's' : ''} has been received. Our team will review and send you confirmation within a few hours. Thank you! 🙏`;
              }
            } catch (error) {
              console.error('[BACKGROUND] Exception in create_reservation:', error);
              toolExecutionContext.push('reservation creation exception');
              assistantReply = "I encountered an error saving your reservation. Please contact us directly.";
            }
          } else if (toolCall.function.name === 'get_date_info') {
            const args = JSON.parse(toolCall.function.arguments);
            const now = new Date();
            const lusaka = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lusaka' }));
            
            let resultDate = null;
            let isPast = false;
            const query = args.query.toLowerCase();
            
            // Handle relative dates
            if (query.includes('today')) {
              resultDate = lusaka;
            } else if (query.includes('tomorrow')) {
              resultDate = new Date(lusaka);
              resultDate.setDate(resultDate.getDate() + 1);
            } else if (query.includes('next monday') || query.includes('monday')) {
              resultDate = new Date(lusaka);
              const daysUntilMonday = (1 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilMonday);
            } else if (query.includes('next tuesday') || query.includes('tuesday')) {
              resultDate = new Date(lusaka);
              const daysUntilTuesday = (2 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilTuesday);
            } else if (query.includes('next wednesday') || query.includes('wednesday')) {
              resultDate = new Date(lusaka);
              const daysUntilWednesday = (3 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilWednesday);
            } else if (query.includes('next thursday') || query.includes('thursday')) {
              resultDate = new Date(lusaka);
              const daysUntilThursday = (4 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilThursday);
            } else if (query.includes('next friday') || query.includes('friday')) {
              resultDate = new Date(lusaka);
              const daysUntilFriday = (5 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilFriday);
            } else if (query.includes('next saturday') || query.includes('saturday')) {
              resultDate = new Date(lusaka);
              const daysUntilSaturday = (6 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilSaturday);
            } else if (query.includes('next sunday') || query.includes('sunday')) {
              resultDate = new Date(lusaka);
              const daysUntilSunday = (7 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilSunday);
            } else if (query.includes('this weekend')) {
              resultDate = new Date(lusaka);
              const daysUntilSaturday = (6 - resultDate.getDay() + 7) % 7;
              resultDate.setDate(resultDate.getDate() + daysUntilSaturday);
            } else {
              // Try to parse as actual date
              try {
                resultDate = new Date(query);
                if (isNaN(resultDate.getTime())) {
                  resultDate = null;
                }
              } catch (e) {
                resultDate = null;
              }
            }
            
            if (resultDate) {
              isPast = resultDate < lusaka;
              const formatted = resultDate.toISOString().split('T')[0];
              const dayName = resultDate.toLocaleDateString('en-US', { weekday: 'long' });
              
              console.log(`[DATE-INFO] Query: "${query}" -> ${formatted} (${dayName})${isPast ? ' - PAST' : ''}`);
              
              // Push to toolResults for AI to process
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({
                  date: formatted,
                  day_name: dayName,
                  is_past: isPast,
                  current_date: lusaka.toISOString().split('T')[0],
                  message: isPast ? 'This date is in the past' : 'This date is valid'
                })
              });
              
              toolExecutionContext.push(`date_info: ${formatted} (${dayName})${isPast ? ' [PAST DATE - INVALID]' : ' [FUTURE DATE - OK]'}`);
              anyToolExecuted = true;
            } else {
              console.log(`[DATE-INFO] Could not parse date query: "${query}"`);
              
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({ error: 'Could not parse date', message: 'Please specify the date more clearly' })
              });
              
              toolExecutionContext.push(`date_info: unable to parse "${query}"`);
              anyToolExecuted = true;
            }
          } else if (toolCall.function.name === 'notify_boss') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] notify_boss called with:', JSON.stringify(args));
            
            try {
              // Map notification types to message formats
              let emoji = '📢';
              let title = 'Notification';
              
              switch (args.notification_type) {
                case 'high_value':
                  emoji = '💎';
                  title = 'High-Value Opportunity';
                  break;
                case 'complaint':
                  emoji = '⚠️';
                  title = 'Customer Complaint';
                  break;
                case 'reservation_change':
                  emoji = '🔄';
                  title = 'Reservation Change Request';
                  break;
                case 'cancellation':
                  emoji = '❌';
                  title = 'Cancellation Request';
                  break;
                case 'vip_info':
                  emoji = '⭐';
                  title = 'VIP Customer Alert';
                  break;
              }
              
              const priorityText = args.priority === 'urgent' ? ' [URGENT]' : '';
              
              const message = `${emoji} ${title}${priorityText}

Customer: ${conversation.customer_name || 'Unknown'}
Phone: ${customerPhone}

${args.summary}

${args.details ? `Details: ${args.details}\n` : ''}
Time: ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Lusaka' })}`;

              // Send notification via Twilio
              const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
              const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
              
              if (!twilioSid || !twilioToken) {
                console.error('[BACKGROUND] Twilio credentials not configured');
                toolExecutionContext.push('boss notification failed - no twilio config');
              } else {
                // Get boss phone
                const bossPhone = company.boss_phone;
                if (!bossPhone) {
                  console.log('[BACKGROUND] No boss phone configured');
                  toolExecutionContext.push('boss notification skipped - no phone');
                } else {
                  const twilioResponse = await fetch(
                    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
                    {
                      method: 'POST',
                      headers: {
                        'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
                        'Content-Type': 'application/x-www-form-urlencoded',
                      },
                      body: new URLSearchParams({
                        To: bossPhone.startsWith('whatsapp:') ? bossPhone : `whatsapp:${bossPhone}`,
                        From: `whatsapp:${company.whatsapp_number || Deno.env.get('TWILIO_WHATSAPP_NUMBER') || '+13344685065'}`,
                        Body: message,
                      }),
                    }
                  );

                  if (!twilioResponse.ok) {
                    const errorText = await twilioResponse.text();
                    console.error('[BACKGROUND] Twilio error:', errorText);
                    toolExecutionContext.push('boss notification failed - twilio error');
                  } else {
                    anyToolExecuted = true;
                    toolExecutionContext.push(`boss notified: ${args.notification_type}`);
                    console.log('[BACKGROUND] Boss notification sent successfully');
                    
                    // Log to boss_conversations
                    await supabase
                      .from('boss_conversations')
                      .insert({
                        company_id: company.id,
                        message_from: 'ai',
                        message_content: message,
                        response: null
                      });
                  }
                }
              }
            } catch (error) {
              console.error('[BACKGROUND] Exception in notify_boss:', error);
              toolExecutionContext.push('boss notification exception');
            }
          } else if (toolCall.function.name === 'deliver_digital_product') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[DELIVER-PRODUCT] Tool called with:', JSON.stringify(args));
            
            try {
              const { data: product, error: productError } = await supabase
                .from('payment_products')
                .select('*')
                .eq('company_id', company.id)
                .eq('product_type', 'digital')
                .eq('is_active', true)
                .ilike('name', `%${args.product_name}%`)
                .maybeSingle();
              
              if (productError || !product) {
                console.error('[DELIVER-PRODUCT] Product not found:', args.product_name, productError);
                toolExecutionContext.push(`product delivery failed - product not found: ${args.product_name}`);
                toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Product not found', message: `Could not find digital product matching "${args.product_name}"` }) });
                assistantReply = `I couldn't find a digital product matching "${args.product_name}". Please verify the product name and try again.`;
                anyToolExecuted = true;
                continue;
              }
              
              let transactionId;
              const { data: transaction } = await supabase
                .from('payment_transactions')
                .select('*')
                .eq('company_id', company.id)
                .eq('customer_phone', customerPhone)
                .eq('product_id', product.id)
                .in('payment_status', ['pending', 'completed'])
                .order('created_at', { ascending: false })
                .maybeSingle();
              
              if (!transaction) {
                const { data: newTx, error: newTxError } = await supabase
                  .from('payment_transactions')
                  .insert({ company_id: company.id, customer_phone: customerPhone, customer_name: conversation.customer_name || 'Customer', product_id: product.id, amount: product.price, currency: product.currency || company.currency_prefix || 'ZMW', payment_status: 'completed', verification_status: 'verified', verified_at: new Date().toISOString(), completed_at: new Date().toISOString(), conversation_id: conversationId, metadata: { delivery_reason: args.reason, delivered_via_ai: true } })
                  .select().single();
                if (newTxError) throw new Error('Failed to create payment record');
                transactionId = newTx.id;
              } else {
                await supabase.from('payment_transactions').update({ payment_status: 'completed', verification_status: 'verified', verified_at: new Date().toISOString(), completed_at: new Date().toISOString(), metadata: { ...(transaction.metadata || {}), delivery_reason: args.reason, delivered_via_ai: true } }).eq('id', transaction.id);
                transactionId = transaction.id;
              }
              
              const deliveryResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/deliver-digital-product`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` }, body: JSON.stringify({ transactionId, companyId: company.id }) });
              if (!deliveryResponse.ok) { const errorText = await deliveryResponse.text(); throw new Error('Failed to deliver product: ' + errorText); }
              const deliveryResult = await deliveryResponse.json();
              
              anyToolExecuted = true;
              toolExecutionContext.push(`delivered digital product: ${product.name}`);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: true, product_name: product.name, delivery_id: deliveryResult?.deliveryId, expires_at: deliveryResult?.expiresAt, message: 'Digital product delivered successfully via WhatsApp' }) });
              
              await supabase.from('boss_conversations').insert({ company_id: company.id, message_from: 'system', message_content: `📦 Digital Product Delivered\n\nProduct: ${product.name}\nCustomer: ${conversation.customer_name || customerPhone}\nReason: ${args.reason}\nDelivery ID: ${deliveryResult?.deliveryId || 'N/A'}`, response: null });
              assistantReply = `I've sent you the download link for *${product.name}*! 📦 Please check your messages - the link will expire in ${product.download_expiry_hours || 48} hours. Thank you for your purchase! 🙏`;
              
            } catch (error) {
              console.error('[DELIVER-PRODUCT] Exception:', error);
              toolExecutionContext.push('product delivery exception');
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error', message: 'Failed to deliver product' }) });
              assistantReply = "I encountered an error delivering your product. Our team has been notified and will send it to you shortly. 🙏";
            }

          } else if (toolCall.function.name === 'create_support_ticket') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[TICKET] Creating support ticket:', JSON.stringify(args));
            
            try {
              // Load company departments for routing context
              const { data: departments } = await supabase
                .from('company_departments')
                .select('name, description, employees')
                .eq('company_id', company.id)
                .eq('is_active', true);
              
              // Auto-recommend department if not provided
              let recommendedDept = args.recommended_department;
              if (!recommendedDept && departments && departments.length > 0) {
                const category = args.issue_category?.toLowerCase() || '';
                const matchedDept = departments.find((d: any) => 
                  d.description?.toLowerCase().includes(category) || 
                  d.name?.toLowerCase().includes(category)
                );
                recommendedDept = matchedDept?.name || departments[0]?.name || 'General Support';
              }
              
              const { data: ticket, error: ticketError } = await supabase
                .from('support_tickets')
                .insert({
                  company_id: company.id,
                  conversation_id: conversationId,
                  ticket_number: '', // trigger generates this
                  customer_name: args.customer_name,
                  customer_phone: customerPhone,
                  issue_summary: args.issue_summary,
                  issue_category: args.issue_category || 'general',
                  recommended_department: recommendedDept || 'General Support',
                  recommended_employee: args.recommended_employee || null,
                  service_recommendations: args.service_recommendations || [],
                  priority: args.priority || 'medium',
                  status: 'open'
                })
                .select()
                .single();
              
              if (ticketError) throw ticketError;
              
              console.log('[TICKET] Created ticket:', ticket.ticket_number);
              
              // Notify boss for high/urgent tickets
              if (['high', 'urgent'].includes(args.priority)) {
                const notifMsg = `🎫 ${args.priority === 'urgent' ? '🚨 URGENT' : '⚠️ HIGH PRIORITY'} TICKET\n\nTicket: ${ticket.ticket_number}\nCustomer: ${args.customer_name}\nCategory: ${args.issue_category}\nIssue: ${args.issue_summary}\nRecommended: ${recommendedDept || 'N/A'}`;
                
                await supabase.from('boss_conversations').insert({
                  company_id: company.id,
                  message_from: 'system',
                  message_content: notifMsg,
                  response: null
                });
                
                // Send WhatsApp notification to boss if configured
                if (company.boss_phone) {
                  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
                  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
                  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
                    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
                    const formData = new URLSearchParams();
                    formData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
                    formData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
                    formData.append('Body', notifMsg);
                    await fetch(twilioUrl, { method: 'POST', headers: { 'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString() });
                  }
                }
              }
              
              anyToolExecuted = true;
              toolExecutionContext.push(`created support ticket: ${ticket.ticket_number}`);
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({
                  success: true,
                  ticket_number: ticket.ticket_number,
                  status: 'open',
                  recommended_department: recommendedDept,
                  priority: args.priority,
                  message: `Ticket ${ticket.ticket_number} created successfully`
                })
              });
              
            } catch (error) {
              console.error('[TICKET] Exception:', error);
              toolExecutionContext.push('ticket creation exception');
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) });
              assistantReply = "I encountered an error creating your ticket. Please try again or contact us directly.";
            }

          } else if (toolCall.function.name === 'recommend_services') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[RECOMMEND] Searching services for:', args.issue_description);
            
            try {
              const recommendations: any[] = [];

              // Try semantic search first
              let usedSemantic = false;
              try {
                const expandedQuery = normalizeSearchQuery(args.issue_description, company);
                const queryVec = await embedQuery(expandedQuery);
                const vectorStr = `[${queryVec.join(',')}]`;
                const { data: semanticResults } = await supabase.rpc('match_products', {
                  query_embedding: vectorStr,
                  match_company_id: company.id,
                  match_threshold: 0.3,
                  match_count: 5,
                });
                if (semanticResults && semanticResults.length > 0) {
                  usedSemantic = true;
                  for (const p of semanticResults) {
                    recommendations.push({
                      type: 'product',
                      name: p.name,
                      description: p.description,
                      price: `${p.currency || 'K'}${p.price}`,
                      similarity: p.similarity,
                    });
                  }
                }
              } catch (embErr) {
                console.warn('[RECOMMEND] Semantic search failed, falling back to keyword:', embErr);
              }

              // Fallback to keyword matching if semantic search didn't work
              if (!usedSemantic) {
                let productQuery = supabase
                  .from('payment_products')
                  .select('name, description, price, currency, category')
                  .eq('company_id', company.id)
                  .eq('is_active', true);
                if (args.category) productQuery = productQuery.eq('category', args.category);
                const { data: products } = await productQuery.limit(10);

                const keywords = args.issue_description.toLowerCase().split(/\s+/);
                if (products) {
                  for (const p of products) {
                    const pText = `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase();
                    if (keywords.some((k: string) => k.length > 3 && pText.includes(k))) {
                      recommendations.push({ type: 'product', name: p.name, description: p.description, price: `${p.currency || 'K'}${p.price}` });
                    }
                  }
                }
              }
              
              // Get quick reference info
              const { data: companyData } = await supabase
                .from('companies')
                .select('quick_reference_info, services')
                .eq('id', company.id)
                .single();

              if (companyData?.quick_reference_info) {
                const refInfo = companyData.quick_reference_info;
                const keywords = args.issue_description.toLowerCase().split(/\s+/);
                if (keywords.some((k: string) => k.length > 3 && refInfo.toLowerCase().includes(k))) {
                  recommendations.push({ type: 'info', content: refInfo.substring(0, 300) });
                }
              }
              
              anyToolExecuted = true;
              toolExecutionContext.push(`found ${recommendations.length} service recommendations`);
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({
                  success: true,
                  recommendations,
                  message: recommendations.length > 0 ? 'Found relevant services' : 'No matching services found for this query'
                })
              });
              
            } catch (error) {
              console.error('[RECOMMEND] Exception:', error);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) });
            }
          } else if (toolCall.function.name === 'lookup_product') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[LOOKUP-PRODUCT] Searching for:', args.query);
            
            try {
              let productList: any[] = [];

              // === EXTERNAL CATALOG MODE ===
              if (company.external_catalog_url && company.external_catalog_key) {
                console.log('[LOOKUP-PRODUCT] Using external catalog');
                const extClient = createClient(company.external_catalog_url, company.external_catalog_key);
                const tableName = company.external_catalog_table || 'ebooks';
                const { data: extProducts, error: extErr } = await extClient
                  .from(tableName)
                  .select('*')
                  .limit(50);

                if (extErr) {
                  console.error('[LOOKUP-PRODUCT] External DB error:', extErr);
                  toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Failed to search products from catalog' }) });
                  continue;
                }

                const queryWords = args.query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
                const allProducts = extProducts || [];
                const matchedProducts = allProducts.filter((p: any) => {
                  const text = `${p.title || p.name || ''} ${p.description || ''} ${p.category || ''} ${p.author || ''}`.toLowerCase();
                  return queryWords.some((word: string) => text.includes(word));
                });
                // NO fallback to all products — only return actual matches
                const resultsToReturn = matchedProducts;
                
                productList = resultsToReturn.slice(0, 10).map((p: any) => ({
                  id: p.id,
                  name: p.title || p.name,
                  description: p.description,
                  price: p.price,
                  currency: p.currency || 'K',
                  category: p.category,
                  product_type: 'digital',
                  delivery_type: 'digital',
                  selar_link: p.selar_link || p.checkout_url || null,
                  author: p.author || null,
                  cover_url: p.cover_url || p.image_url || null,
                }));
              } else {
                // === LOCAL CATALOG MODE — Semantic Search with fallback ===
                let usedSemantic = false;

                try {
                  const expandedQuery = normalizeSearchQuery(args.query, company);
                  const queryVec = await embedQuery(expandedQuery);
                  const vectorStr = `[${queryVec.join(',')}]`;
                  const { data: semanticResults, error: rpcErr } = await supabase.rpc('match_products', {
                    query_embedding: vectorStr,
                    match_company_id: company.id,
                    match_threshold: 0.3,
                    match_count: 10,
                  });

                  if (!rpcErr && semanticResults && semanticResults.length > 0) {
                    usedSemantic = true;
                    console.log(`[LOOKUP-PRODUCT] Semantic search found ${semanticResults.length} results`);
                    productList = semanticResults.map((p: any) => ({
                      id: p.id,
                      name: p.name,
                      description: p.description,
                      price: p.price,
                      currency: p.currency || 'K',
                      category: p.category,
                      product_type: p.product_type,
                      delivery_type: p.delivery_type,
                      selar_link: p.selar_link,
                      similarity: p.similarity,
                    }));
                  } else if (rpcErr) {
                    console.warn('[LOOKUP-PRODUCT] Semantic RPC error:', rpcErr.message);
                  }
                } catch (embErr) {
                  console.warn('[LOOKUP-PRODUCT] Embedding failed, falling back to keyword:', embErr);
                }

                // Fallback to keyword matching (but NO "return all" fallback)
                if (!usedSemantic) {
                  let productQuery = supabase
                    .from('payment_products')
                    .select('id, name, description, price, currency, category, product_type, delivery_type, selar_link')
                    .eq('company_id', company.id)
                    .eq('is_active', true);
                  
                  if (args.category) {
                    productQuery = productQuery.eq('category', args.category);
                  }
                  
                  const { data: products, error: prodError } = await productQuery.limit(20);
                  
                  if (prodError) {
                    console.error('[LOOKUP-PRODUCT] DB error:', prodError);
                    toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Failed to search products' }) });
                    continue;
                  }

                  const queryWords = args.query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
                  const matchedProducts = (products || []).filter((p: any) => {
                    const text = `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase();
                    return queryWords.some((word: string) => text.includes(word));
                  });
                  
                  // NO fallback to all products — only return actual matches
                  productList = matchedProducts.slice(0, 10).map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    price: p.price,
                    currency: p.currency || 'K',
                    category: p.category,
                    product_type: p.product_type,
                    delivery_type: p.delivery_type,
                    selar_link: p.selar_link
                  }));
                }
              }

              anyToolExecuted = true;
              toolExecutionContext.push(`found ${productList.length} products matching "${args.query}"`);
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({
                  success: true,
                  products: productList,
                  total_found: productList.length,
                  query: args.query,
                  message: productList.length > 0 
                    ? `Found ${productList.length} product(s) matching your search`
                    : 'No products found matching that query. Try a different search term.'
                })
              });
              console.log('[LOOKUP-PRODUCT] Found', productList.length, 'products');
            } catch (error) {
              console.error('[LOOKUP-PRODUCT] Exception:', error);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) });
            }
          } else if (toolCall.function.name === 'search_media') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[SEARCH-MEDIA] Query:', args.query, 'media_type:', args.media_type);
            try {
              let results: any[] = [];

              // Detect requested media type from explicit arg OR query keywords
              const requestedMediaType: 'image' | 'video' | null =
                args.media_type === 'video' || /\b(video|videos|clip|clips|reel|reels|footage)\b/i.test(args.query || '')
                  ? 'video'
                  : args.media_type === 'image' ? 'image' : null;

              // 1. Try semantic vector search first
              try {
                const expandedQuery = normalizeSearchQuery(args.query, company);
                const queryVec = await embedQuery(expandedQuery);
                const vectorStr = `[${queryVec.join(',')}]`;
                const { data: mediaResults, error: mediaErr } = await supabase.rpc('match_media', {
                  query_embedding: vectorStr,
                  match_company_id: company.id,
                  match_threshold: 0.25,
                  match_count: args.count || 5,
                });

                if (!mediaErr && mediaResults && mediaResults.length > 0) {
                  const filtered = requestedMediaType
                    ? mediaResults.filter((m: any) => m.media_type === requestedMediaType)
                    : mediaResults;
                  results = filtered.map((m: any) => ({
                    description: m.description,
                    category: m.category,
                    media_type: m.media_type,
                    tags: m.tags,
                    url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`,
                    file_path: m.file_path,
                    similarity: m.similarity,
                  }));
                }
              } catch (vecErr) {
                console.error('[SEARCH-MEDIA] Vector search failed, falling back to text:', vecErr);
              }

              // 2. Fallback: text-based search if vector returned nothing
              if (results.length === 0) {
                console.log('[SEARCH-MEDIA] Vector search returned 0, trying text fallback');
                const searchTerms = args.query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
                const ilikeClauses = searchTerms.map((t: string) => `file_name.ilike.%${t}%,description.ilike.%${t}%`).join(',');
                
                let textQuery = supabase
                  .from('company_media')
                  .select('description, category, file_path, media_type, file_type, tags, file_name')
                  .eq('company_id', company.id);
                if (requestedMediaType) textQuery = textQuery.eq('media_type', requestedMediaType);
                const { data: textResults } = await textQuery
                  .or(ilikeClauses)
                  .limit(args.count || 5);

                if (textResults && textResults.length > 0) {
                  results = textResults.map((m: any) => ({
                    description: m.description,
                    category: m.category,
                    media_type: m.media_type,
                    tags: m.tags,
                    url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`,
                    file_path: m.file_path,
                    similarity: 0.5,
                  }));
                  console.log(`[SEARCH-MEDIA] Text fallback found ${results.length} results`);
                }
              }

              // 3. Last resort: return latest media from this company's library
              // Honors requested media_type so "send a video" doesn't silently fall back to images.
              if (results.length === 0) {
                console.log(`[SEARCH-MEDIA] No text matches, returning latest ${requestedMediaType || 'any'} media from library`);
                let lastResort = supabase
                  .from('company_media')
                  .select('description, category, file_path, media_type, file_type, tags, file_name')
                  .eq('company_id', company.id);
                if (requestedMediaType) lastResort = lastResort.eq('media_type', requestedMediaType);
                const { data: anyMedia } = await lastResort
                  .order('created_at', { ascending: false })
                  .limit(args.count || 5);

                if (anyMedia && anyMedia.length > 0) {
                  results = anyMedia.map((m: any) => ({
                    description: m.description || m.file_name,
                    category: m.category,
                    media_type: m.media_type,
                    tags: m.tags,
                    url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`,
                    file_path: m.file_path,
                    similarity: 0.3,
                  }));
                  console.log(`[SEARCH-MEDIA] Returned ${results.length} latest ${requestedMediaType || 'any'} media as fallback`);
                }
              }

              anyToolExecuted = true;
              toolExecutionContext.push(`search_media found ${results.length} results for "${args.query}"`);
              toolResults.push({
                tool_call_id: toolCall.id, role: "tool",
                content: JSON.stringify({ success: true, media: results, total: results.length, message: results.length > 0 ? 'Found matching media. Use send_media with the URLs above.' : 'No matching media found.' })
              });
            } catch (error) {
              console.error('[SEARCH-MEDIA] Error:', error);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Media search failed' }) });
            }
          } else if (toolCall.function.name === 'search_knowledge') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[SEARCH-KNOWLEDGE] Query:', args.query);
            try {
              const queryVec = await embedQuery(args.query);
              const vectorStr = `[${queryVec.join(',')}]`;
              const { data: docResults, error: docErr } = await supabase.rpc('match_documents', {
                query_embedding: vectorStr,
                match_company_id: company.id,
                match_threshold: 0.25,
                match_count: 3,
              });

              let results: any[] = [];
              if (!docErr && docResults && docResults.length > 0) {
                results = docResults.map((d: any) => ({
                  filename: d.filename,
                  content: d.parsed_content?.substring(0, 800) || '',
                  similarity: d.similarity,
                }));
              }

              // Also check quick_reference_info as fallback
              let quickRef = '';
              if (results.length === 0 && company.quick_reference_info) {
                quickRef = company.quick_reference_info;
              }

              anyToolExecuted = true;
              toolExecutionContext.push(`search_knowledge found ${results.length} documents for "${args.query}"`);
              toolResults.push({
                tool_call_id: toolCall.id, role: "tool",
                content: JSON.stringify({ success: true, documents: results, quick_reference: quickRef || undefined, message: results.length > 0 ? 'Found relevant knowledge base content.' : (quickRef ? 'No document matches but quick reference info available.' : 'No matching knowledge base content found.') })
              });
            } catch (error) {
              console.error('[SEARCH-KNOWLEDGE] Error:', error);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Knowledge search failed' }) });
            }
          } else if (toolCall.function.name === 'search_past_conversations') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[SEARCH-CONVERSATIONS] Query:', args.query);
            try {
              const queryVec = await embedQuery(args.query);
              const vectorStr = `[${queryVec.join(',')}]`;
              const { data: convResults, error: convErr } = await supabase.rpc('match_conversations', {
                query_embedding: vectorStr,
                match_company_id: company.id,
                match_threshold: 0.3,
                match_count: 5,
              });

              let results: any[] = [];
              if (!convErr && convResults && convResults.length > 0) {
                // Optionally filter by customer phone
                let filtered = convResults;
                if (args.customer_phone) {
                  const normPhone = args.customer_phone.replace(/\D/g, '');
                  filtered = convResults.filter((c: any) => c.phone && c.phone.includes(normPhone));
                  if (filtered.length === 0) filtered = convResults; // fallback to all
                }
                results = filtered.map((c: any) => ({
                  customer_name: c.customer_name,
                  phone: c.phone,
                  date: c.started_at,
                  transcript_preview: c.transcript?.substring(0, 400) || 'No transcript available',
                  similarity: c.similarity,
                }));
              }
              anyToolExecuted = true;
              toolExecutionContext.push(`search_past_conversations found ${results.length} results`);
              toolResults.push({
                tool_call_id: toolCall.id, role: "tool",
                content: JSON.stringify({ success: true, conversations: results, message: results.length > 0 ? 'Found past conversations.' : 'No matching past conversations found.' })
              });
            } catch (error) {
              console.error('[SEARCH-CONVERSATIONS] Error:', error);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Conversation search failed' }) });
            }
          } else if (['check_stock','record_sale','get_product_variants','list_products','create_order','get_order_status','cancel_order','get_customer_history','get_company_statistics','create_quotation','create_invoice','create_contact','generate_payment_link'].includes(toolCall.function.name)) {
            // === EXTERNAL CATALOG: Intercept list_products and check_stock ===
            if (company.external_catalog_url && company.external_catalog_key && ['list_products', 'check_stock'].includes(toolCall.function.name)) {
              const args = JSON.parse(toolCall.function.arguments);
              console.log(`[EXT-CATALOG] Intercepting ${toolCall.function.name}:`, JSON.stringify(args).slice(0, 200));
              
              try {
                const extClient = createClient(company.external_catalog_url, company.external_catalog_key);
                const tableName = company.external_catalog_table || 'ebooks';
                
                if (toolCall.function.name === 'list_products') {
                  let extQuery = extClient.from(tableName).select('*');
                  if (args.category) {
                    extQuery = extQuery.eq('category', args.category);
                  }
                  const { data: extProducts, error: extErr } = await extQuery.limit(50);
                  
                  if (extErr) throw new Error(extErr.message);
                  
                  const productList = (extProducts || []).map((p: any) => ({
                    name: p.title || p.name,
                    description: p.description,
                    unit_price: p.price,
                    currency: p.currency || 'K',
                    category: p.category,
                    current_stock: 'Digital - Always Available',
                    author: p.author || null,
                    selar_link: p.selar_link || p.checkout_url || null,
                  }));
                  
                  anyToolExecuted = true;
                  toolExecutionContext.push(`listed ${productList.length} external catalog products`);
                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: JSON.stringify({ success: true, products: productList, total: productList.length })
                  });
                } else {
                  // check_stock — digital products are always in stock
                  anyToolExecuted = true;
                  toolExecutionContext.push(`checked stock for "${args.product_name}" (digital, always available)`);
                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: JSON.stringify({
                      success: true,
                      product_name: args.product_name,
                      current_stock: 'Unlimited',
                      status: 'in_stock',
                      message: 'Digital product — always available for immediate delivery'
                    })
                  });
                }
                continue;
              } catch (extErr) {
                console.error(`[EXT-CATALOG] ${toolCall.function.name} failed:`, extErr);
                // Fall through to normal BMS handling
              }
            }
            const bmsToolName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[BMS] ${bmsToolName} called:`, JSON.stringify(args).slice(0, 200));
            
            // Forward all args directly to bms-agent — it handles flattening
            const bmsParams: Record<string, any> = { ...args };

            // Inject company_id for multi-tenant BMS routing
            bmsParams.company_id = company.id;

            try {
              let bmsResult = await bmsCallWithAck(
                () => fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bms-agent`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: bmsToolName, params: bmsParams, conversation_id: conversationId }),
                }),
                bmsToolName,
                customerPhone,
                company.whatsapp_number || ''
              );

              // ── check_stock fallback: if product not found in results, search full catalog via list_products ──
              if (bmsToolName === 'check_stock' && bmsResult && args.product_name && args.product_name !== 'all') {
                const searchName = (args.product_name || '').toLowerCase();
                const stockData = Array.isArray(bmsResult.data) ? bmsResult.data : (Array.isArray(bmsResult) ? bmsResult : []);
                const found = stockData.some((p: any) => {
                  const pName = (p.name || p.product_name || '').toLowerCase();
                  return pName.includes(searchName) || searchName.includes(pName);
                });
                if (!found) {
                  console.log(`[BMS-FALLBACK] check_stock didn't find "${args.product_name}" in ${stockData.length} results, trying list_products`);
                  try {
                    const catalogRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bms-agent`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'list_products', params: { company_id: company.id, search: args.product_name }, conversation_id: conversationId }),
                    });
                    const catalogData = await catalogRes.json();
                    const allProducts = Array.isArray(catalogData?.data) ? catalogData.data : [];
                    // Smart matching: split search into words and require all words to appear
                    const searchWords = searchName.split(/\s+/).filter((w: string) => w.length > 1);
                    const matched = allProducts.filter((p: any) => {
                      const pName = (p.name || p.product_name || '').toLowerCase();
                      if (searchWords.length > 1) {
                        return searchWords.every((word: string) => pName.includes(word));
                      }
                      return pName.includes(searchName) || searchName.includes(pName);
                    });
                    if (matched.length > 0) {
                      const stockSummary = matched.map((p: any) => {
                        const stock = p.current_stock ?? p.stock ?? 0;
                        const price = p.unit_price ?? p.price ?? '';
                        const inStock = stock > 0 ? `${stock} in stock` : 'OUT OF STOCK';
                        return `${p.name || p.product_name} - ${inStock}${price ? ` at K${price}` : ''}`;
                      }).join(', ');
                      console.log(`[BMS-FALLBACK] Found ${matched.length} matching product(s) in full catalog: ${stockSummary}`);
                      bmsResult = { 
                        success: true, 
                        data: matched,
                        message: `Found ${matched.length} matching product(s): ${stockSummary}`
                      };
                    } else {
                      console.log(`[BMS-FALLBACK] Product "${args.product_name}" not found in full catalog (${allProducts.length} products)`);
                      bmsResult = { success: true, data: [], message: `Product "${args.product_name}" not found in inventory. Available products: ${allProducts.slice(0, 20).map((p: any) => p.name).join(', ')}` };
                    }
                  } catch (fallbackErr) {
                    console.error(`[BMS-FALLBACK] list_products fallback failed:`, fallbackErr);
                  }
                }
              }

              anyToolExecuted = true;
              toolExecutionContext.push(`BMS ${bmsToolName} executed`);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify(bmsResult) });

              // ── Auto-send PDF to customer + notify boss for quotations/invoices ──
              if ((bmsToolName === 'create_quotation' || bmsToolName === 'create_invoice') && bmsResult && !bmsResult.error) {
                const docType = bmsToolName === 'create_quotation' ? 'quotation' : 'invoice';
                console.log(`[AUTO-DOC] Generating ${docType} PDF for customer ${customerPhone}`);
                try {
                  const docResponse = await fetch(
                    `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-document`,
                    {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        company_id: company.id,
                        document_type: docType,
                        data: bmsResult,
                        customer_name: args.customer_name || customerName || 'Customer',
                        customer_phone: customerPhone,
                      }),
                    }
                  );

                  if (docResponse.ok) {
                    const docResult = await docResponse.json();
                    const pdfUrl = docResult.pdf_url || docResult.url;

                    if (pdfUrl) {
                      // Send PDF to customer via Twilio WhatsApp
                      const senderNumber = company.whatsapp_number || '';
                      if (senderNumber) {
                        console.log(`[AUTO-DOC] Sending ${docType} PDF to customer: ${customerPhone}`);
                        try {
                          const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
                          const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
                          if (twilioSid && twilioToken) {
                            const twilioResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                              method: 'POST',
                              headers: {
                                'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
                                'Content-Type': 'application/x-www-form-urlencoded',
                              },
                              body: new URLSearchParams({
                                To: customerPhone.startsWith('whatsapp:') ? customerPhone : `whatsapp:${customerPhone}`,
                                From: senderNumber.startsWith('whatsapp:') ? senderNumber : `whatsapp:${senderNumber}`,
                                MediaUrl: pdfUrl,
                                Body: `📄 Here is your ${docType}. Please review and let us know if you have any questions.`,
                              }),
                            });
                            if (!twilioResp.ok) {
                              const errBody = await twilioResp.text().catch(() => '');
                              console.error(`[AUTO-DOC] Twilio send failed: ${twilioResp.status}`, errBody);
                            } else {
                              console.log(`[AUTO-DOC] ${docType} PDF sent to customer successfully`);
                            }
                          }
                        } catch (sendErr) {
                          console.error(`[AUTO-DOC] Failed to send PDF to customer:`, sendErr);
                        }
                      }

                      // Notify boss via WhatsApp
                      const bossPhone = company.boss_phone;
                      if (bossPhone && senderNumber) {
                        console.log(`[AUTO-DOC] Notifying boss about ${docType}: ${bossPhone}`);
                        const itemsSummary = (args.items || []).map((it: any) => `${it.name || it.product_name} x${it.quantity || 1}`).join(', ');
                        const totalAmount = bmsResult.total || bmsResult.grand_total || 'N/A';
                        const bossMsg = `📄 ${docType.toUpperCase()} SENT\nCustomer: ${args.customer_name || customerName || customerPhone}\nItems: ${itemsSummary || 'See document'}\nTotal: ${company.currency_prefix || 'K'}${totalAmount}\n[PDF attached]`;
                        try {
                          const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
                          const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
                          if (twilioSid && twilioToken) {
                            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                              method: 'POST',
                              headers: {
                                'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
                                'Content-Type': 'application/x-www-form-urlencoded',
                              },
                              body: new URLSearchParams({
                                To: bossPhone.startsWith('whatsapp:') ? bossPhone : `whatsapp:${bossPhone}`,
                                From: senderNumber.startsWith('whatsapp:') ? senderNumber : `whatsapp:${senderNumber}`,
                                MediaUrl: pdfUrl,
                                Body: bossMsg,
                              }),
                            });
                            console.log(`[AUTO-DOC] Boss notified about ${docType}`);
                          }
                        } catch (bossErr) {
                          console.error(`[AUTO-DOC] Failed to notify boss:`, bossErr);
                        }

                        // Log to boss_conversations
                        await supabase.from('boss_conversations').insert({
                          company_id: company.id,
                          message_from: 'system',
                          message_content: bossMsg,
                          handed_off_by: 'auto-doc-delivery',
                        });
                      }
                    }
                  } else {
                    console.error(`[AUTO-DOC] generate-document failed: ${docResponse.status}`);
                  }
                } catch (docErr) {
                  console.error(`[AUTO-DOC] Document generation error:`, docErr);
                }
              }
            } catch (error) {
              console.error(`[BMS] ${bmsToolName} error:`, error);
              anyToolExecuted = true;
              toolExecutionContext.push(`BMS ${bmsToolName} failed`);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ error: error instanceof Error ? error.message : 'BMS system unavailable' }) });
            }
          }
        }
      }

      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      const originalError = error instanceof Error ? error.message : String(error);
      console.error('[BACKGROUND] AI processing error:', originalError);

      // Log the original error for monitoring
      try {
        await supabase.from('ai_error_logs').insert({
          company_id: company.id,
          conversation_id: conversationId,
          error_type: 'ai_call_failed',
          severity: 'high',
          original_message: lastUserMessage || '',
          ai_response: '',
          analysis_details: { original_error: originalError, stage: 'primary_ai_call' },
        });
      } catch (logErr) { console.error('[ERROR-LOG] Failed to log error:', logErr); }

      // --- Retry 1: fallback chain (DeepSeek → Lovable Gateway), NO tools, same context ---
      console.log('[RETRY-1] Attempting fallback chain with no tools...');
      try {
        const retry1Controller = new AbortController();
        const retry1Timeout = setTimeout(() => retry1Controller.abort(), 30000);
        const retry1Response = await geminiChatWithFallback({
          model: 'deepseek-chat',
          messages: sanitizeMessages(messages),
          temperature: 1.0,
          max_tokens: maxTokens,
          signal: retry1Controller.signal,
        });
        clearTimeout(retry1Timeout);
        if (retry1Response.ok) {
          const retry1Data = await retry1Response.json();
          const retry1Reply = retry1Data.choices?.[0]?.message?.content;
          if (retry1Reply) {
            console.log('[RETRY-1] Success — got response from fallback chain');
            assistantReply = retry1Reply;
          }
        }
      } catch (retry1Err) {
        console.error('[RETRY-1] Failed:', retry1Err instanceof Error ? retry1Err.message : retry1Err);
      }

      // --- Retry 2: fallback chain, NO tools, truncated context (last 3 msgs) ---
      if (!assistantReply) {
        console.log('[RETRY-2] Attempting with truncated context (last 3 messages)...');
        try {
          const systemMsg = messages.find((m: any) => m.role === 'system');
          const userMsgs = messages.filter((m: any) => m.role !== 'system').slice(-3);
          const truncatedMessages = systemMsg ? [systemMsg, ...userMsgs] : userMsgs;

          const retry2Controller = new AbortController();
          const retry2Timeout = setTimeout(() => retry2Controller.abort(), 30000);
          const retry2Response = await geminiChatWithFallback({
            model: 'deepseek-chat',
            messages: sanitizeMessages(truncatedMessages),
            temperature: 1.0,
            max_tokens: 512,
            signal: retry2Controller.signal,
          });
          clearTimeout(retry2Timeout);
          if (retry2Response.ok) {
            const retry2Data = await retry2Response.json();
            const retry2Reply = retry2Data.choices?.[0]?.message?.content;
            if (retry2Reply) {
              console.log('[RETRY-2] Success — got response from truncated context');
              assistantReply = retry2Reply;
            }
          }
        } catch (retry2Err) {
          console.error('[RETRY-2] Failed:', retry2Err instanceof Error ? retry2Err.message : retry2Err);
        }
      }

      // --- Final: use company's configured fallback message + notify boss ---
      if (!assistantReply) {
        console.warn('[RETRY-EXHAUSTED] All retries failed, using company fallback message');
        assistantReply = fallbackMessage;

        // Notify boss about complete AI failure
        try {
          const bossPhones = await getBossPhones(supabase, company.id, company.boss_phone);
          for (const bp of bossPhones) {
            await sendTwilioMessage(
              bp,
              `⚠️ AI completely failed for customer ${customerName || customerPhone}. All retries exhausted. Error: ${originalError.slice(0, 200)}. Please check manually.`,
              company.whatsapp_number || company.twilio_number || ''
            );
          }
        } catch (notifyErr) { console.error('[BOSS-NOTIFY] Failed:', notifyErr); }
      }
    }

    // CRITICAL: Multi-round tool loop — keep calling AI with tools until no more tool calls
    let maxToolRounds = Math.min(aiOverrides?.max_tool_rounds || 3, 8); // safe cap (raised from 5 to honor configs like ANZ=6)
    
    // Ensure at least 3 rounds when checkout tools are active (check_stock -> record_sale -> generate_payment_link)
    const checkoutToolNames = (filteredTools || []).map((t: any) => t.function?.name).filter(Boolean);
    const hasCheckoutTools = checkoutToolNames.includes('check_stock') && 
                             checkoutToolNames.includes('record_sale') && 
                             checkoutToolNames.includes('generate_payment_link');
    if (hasCheckoutTools && maxToolRounds < 4) {
      console.log(`[TOOL-LOOP] Bumping max_tool_rounds from ${maxToolRounds} to 4 for full checkout flow`);
      maxToolRounds = 4;
    }
    // Floor of 3 for any BMS-enabled company so list/check chains don't silently truncate
    const hasBmsReadTools = checkoutToolNames.some((n: string) =>
      ['list_products', 'check_stock', 'bms_list_products', 'bms_check_stock', 'lookup_product'].includes(n)
    );
    if (hasBmsReadTools && maxToolRounds < 3) {
      console.log(`[TOOL-LOOP] Bumping max_tool_rounds from ${maxToolRounds} to 3 for BMS read chain`);
      maxToolRounds = 3;
    }
    let currentRound = 0;
    let currentToolCalls = aiData?.choices?.[0]?.message?.tool_calls;
    
    // Validate tool_calls structure
    if (currentToolCalls && !Array.isArray(currentToolCalls)) {
      console.warn('[TOOL-LOOP] Invalid tool_calls structure, skipping loop');
      currentToolCalls = null;
    }
    let currentMessages = [...messages];

    // Snapshot the FIRST round's tool results into the cumulative buffer before they get reset.
    for (const tr of toolResults) {
      allToolResults.push({ ...tr, fn: (currentToolCalls || []).find((c: any) => c.id === tr.tool_call_id)?.function?.name });
    }

    while (toolResults.length > 0 && currentRound < maxToolRounds) {
      currentRound++;
      console.log(`[TOOL-LOOP] Round ${currentRound}/${maxToolRounds}, processing ${toolResults.length} tool results`);
      
      try {
        // Build messages array with tool results
        currentMessages = [
          ...currentMessages,
          {
            role: "assistant",
            content: assistantReply || "",
            ...(currentToolCalls && currentToolCalls.length > 0 ? { tool_calls: currentToolCalls } : {})
          },
          ...toolResults
        ];
        
        // Check if this is a reservation flow and add validation reminder
        const isReservationFlow = currentMessages.some(msg => 
          msg.content && typeof msg.content === 'string' && 
          (msg.content.toLowerCase().includes('reservation') || 
           msg.content.toLowerCase().includes('booking'))
        );
        
        if (isReservationFlow) {
          currentMessages.push({
            role: "system",
            content: `CRITICAL REMINDER: If customer just provided name/email/guests, CHECK if you now have all 6 required items (name, email, guests, phone, date, time). If ALL 6 present → IMMEDIATELY call create_reservation tool. If any missing → Ask for specific missing items only.`
          });
        }
        
        const roundController = new AbortController();
        const roundTimeoutId = setTimeout(() => roundController.abort(), 60000);
        
        // Call AI WITH tools still available for multi-step chains
        const roundResponse = await geminiChat({
          model: selectedModel,
          messages: sanitizeMessages(currentMessages),
          temperature: 1.0,
          max_tokens: maxTokens,
          tools: filteredTools,
          tool_choice: "auto",
          signal: roundController.signal,
        });
        
        clearTimeout(roundTimeoutId);
        
        if (!roundResponse.ok) {
          const errBody = await roundResponse.text().catch(() => 'no body');
          console.error(`[TOOL-LOOP] Round ${currentRound} AI call failed: ${roundResponse.status}`, errBody.slice(0, 500));
          // Leave assistantReply empty so the synthesis fallback below can build a real reply from tool results
          break;
        }
        
        const roundData = await roundResponse.json();
        assistantReply = roundData.choices[0].message.content || assistantReply || '';
        const newToolCalls = roundData.choices[0].message.tool_calls;
        
        console.log(`[TOOL-LOOP] Round ${currentRound} result:`, {
          hasReply: !!roundData.choices[0].message.content,
          newToolCalls: newToolCalls?.map((t: any) => t.function.name) || []
        });
        
        if (!newToolCalls || newToolCalls.length === 0) {
          console.log(`[TOOL-LOOP] No more tool calls after round ${currentRound}, done.`);
          break;
        }
        
        // Execute the new tool calls
        toolResults = [];
        currentToolCalls = newToolCalls;
        aiData = roundData;
        
        for (const toolCall of newToolCalls) {
          // Re-use existing tool execution logic by re-dispatching
          // We need to handle each tool type inline here
          const fnName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          console.log(`[TOOL-LOOP] Round ${currentRound} executing: ${fnName}`);
          
          const BMS_TOOLS = ['check_stock','record_sale','credit_sale','get_product_variants','list_products','create_order','get_order_status','cancel_order','get_customer_history','get_company_statistics','get_sales_summary','get_sales_details','create_quotation','create_invoice','create_contact','generate_payment_link','low_stock_alerts','get_low_stock_items','bulk_add_inventory','check_customer','who_owes','send_receipt','send_invoice','send_quotation','send_payslip','daily_report','pending_orders','update_stock','update_order_status','record_expense','get_expenses','get_outstanding_receivables','get_outstanding_payables','profit_loss_report','clock_in','clock_out','my_attendance','my_tasks','my_pay','my_schedule','team_attendance','sales_report'];
          
          if (BMS_TOOLS.includes(fnName)) {
            // Forward all args directly to bms-agent
            const bmsParams: Record<string, any> = { ...args, company_id: company.id };
            
            try {
              const bmsResult = await bmsCallWithAck(
                () => fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bms-agent`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: fnName, params: bmsParams, conversation_id: conversationId }),
                }),
                fnName,
                customerPhone,
                company.whatsapp_number || ''
              );
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify(bmsResult) });
              toolExecutionContext.push(`[R${currentRound}] BMS ${fnName} completed`);
              
              // Auto-send PDF for quotations/invoices created in tool loop rounds
              if ((fnName === 'create_quotation' || fnName === 'create_invoice') && bmsResult && !bmsResult.error) {
                const docType = fnName === 'create_quotation' ? 'quotation' : 'invoice';
                console.log(`[AUTO-DOC-R${currentRound}] Generating ${docType} PDF`);
                try {
                  const docResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-document`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_id: company.id, document_type: docType, data: bmsResult, customer_name: args.customer_name || customerName || 'Customer', customer_phone: customerPhone }),
                  });
                  if (docResp.ok) {
                    const docResult = await docResp.json();
                    const pdfUrl = docResult.pdf_url || docResult.url;
                    if (pdfUrl) {
                      const senderNumber = company.whatsapp_number || '';
                      const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
                      const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
                      if (senderNumber && twilioSid && twilioToken) {
                        // Send PDF to customer
                        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                          method: 'POST',
                          headers: { 'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`), 'Content-Type': 'application/x-www-form-urlencoded' },
                          body: new URLSearchParams({ To: `whatsapp:${customerPhone}`, From: `whatsapp:${senderNumber}`, MediaUrl: pdfUrl, Body: `📄 Here is your ${docType}. Please review and let us know if you have any questions.` }),
                        });
                        // Notify boss
                        if (company.boss_phone) {
                          const itemsSummary = (args.items || []).map((it: any) => `${it.name || it.product_name} x${it.quantity || 1}`).join(', ');
                          const totalAmount = bmsResult.total || bmsResult.grand_total || 'N/A';
                          const bossMsg = `📄 ${docType.toUpperCase()} SENT\nCustomer: ${args.customer_name || customerName || customerPhone}\nItems: ${itemsSummary || 'See document'}\nTotal: ${company.currency_prefix || 'K'}${totalAmount}\n[PDF attached]`;
                          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                            method: 'POST',
                            headers: { 'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`), 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({ To: `whatsapp:${company.boss_phone}`, From: `whatsapp:${senderNumber}`, MediaUrl: pdfUrl, Body: bossMsg }),
                          });
                          await supabase.from('boss_conversations').insert({ company_id: company.id, message_from: 'system', message_content: bossMsg, handed_off_by: 'auto-doc-delivery' });
                        }
                      }
                      console.log(`[AUTO-DOC-R${currentRound}] ${docType} PDF sent`);
                    }
                  }
                } catch (docErr) {
                  console.error(`[AUTO-DOC-R${currentRound}] PDF generation failed:`, docErr);
                }
              }
            } catch (e) {
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ error: 'BMS unavailable' }) });
              try {
                await supabase.from('ai_error_logs').insert({
                  company_id: company.id, conversation_id: conversationId, error_type: 'tool_failure', severity: 'warning',
                  original_message: userMessage, ai_response: `Tool ${fnName} failed in round ${currentRound}`,
                  analysis_details: { tool_name: fnName, round: currentRound, error: String(e) }, auto_flagged: true
                });
              } catch (_logErr) { /* silent */ }
            }
          } else if (fnName === 'send_media') {
            // ===== ACTUAL MEDIA DISPATCH IN MULTI-ROUND LOOP (unified) =====
            console.log(`[TOOL-LOOP-MEDIA] Round ${currentRound}: Executing send_media with ${args.media_urls?.length || 0} URLs`);
            const { result: mediaResult, textReply: mediaTextReply } = await handleSendMedia(args, company, customerPhone, conversationId, supabase);
            toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify(mediaResult) });
            toolExecutionContext.push(`[R${currentRound}] send_media: ${mediaResult.sent}/${mediaResult.total} sent`);
            console.log(`[TOOL-LOOP-MEDIA] Result: ${mediaResult.sent}/${mediaResult.total}`);
          } else if (fnName === 'search_media') {
            // ===== ACTUAL SEARCH_MEDIA IN MULTI-ROUND LOOP =====
            console.log(`[TOOL-LOOP] Round ${currentRound}: Executing search_media for "${args.query}" media_type=${args.media_type}`);
            try {
              let results: any[] = [];
              const requestedMediaType: 'image' | 'video' | null =
                args.media_type === 'video' || /\b(video|videos|clip|clips|reel|reels|footage)\b/i.test(args.query || '')
                  ? 'video'
                  : args.media_type === 'image' ? 'image' : null;
              try {
                const expandedQuery = normalizeSearchQuery(args.query, company);
                const queryVec = await embedQuery(expandedQuery);
                const vectorStr = `[${queryVec.join(',')}]`;
                const { data: mediaResults, error: mediaErr } = await supabase.rpc('match_media', {
                  query_embedding: vectorStr,
                  match_company_id: company.id,
                  match_threshold: 0.25,
                  match_count: args.count || 5,
                });
                if (!mediaErr && mediaResults && mediaResults.length > 0) {
                  const filtered = requestedMediaType
                    ? mediaResults.filter((m: any) => m.media_type === requestedMediaType)
                    : mediaResults;
                  results = filtered.map((m: any) => ({
                    description: m.description, category: m.category, media_type: m.media_type, tags: m.tags,
                    url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`,
                    file_path: m.file_path,
                    similarity: m.similarity,
                  }));
                }
              } catch (vecErr) {
                console.error('[TOOL-LOOP-SEARCH] Vector search failed:', vecErr);
              }
              if (results.length === 0) {
                const searchTerms = args.query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
                const ilikeClauses = searchTerms.map((t: string) => `file_name.ilike.%${t}%,description.ilike.%${t}%`).join(',');
                let textQuery = supabase
                  .from('company_media')
                  .select('description, category, file_path, media_type, tags, file_name')
                  .eq('company_id', company.id);
                if (requestedMediaType) textQuery = textQuery.eq('media_type', requestedMediaType);
                const { data: textResults } = await textQuery
                  .or(ilikeClauses)
                  .limit(args.count || 5);
                if (textResults && textResults.length > 0) {
                  results = textResults.map((m: any) => ({
                    description: m.description, category: m.category, media_type: m.media_type, tags: m.tags,
                    url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`,
                    file_path: m.file_path,
                    similarity: 0.5,
                  }));
                }
              }
              if (results.length === 0) {
                let lastResort = supabase
                  .from('company_media')
                  .select('description, category, file_path, media_type, tags, file_name')
                  .eq('company_id', company.id);
                if (requestedMediaType) lastResort = lastResort.eq('media_type', requestedMediaType);
                const { data: anyMedia } = await lastResort
                  .order('created_at', { ascending: false })
                  .limit(args.count || 5);
                if (anyMedia && anyMedia.length > 0) {
                  results = anyMedia.map((m: any) => ({
                    description: m.description || m.file_name, category: m.category, media_type: m.media_type, tags: m.tags,
                    url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${m.file_path}`,
                    file_path: m.file_path,
                    similarity: 0.3,
                  }));
                }
              }
              toolResults.push({
                tool_call_id: toolCall.id, role: "tool",
                content: JSON.stringify({ success: true, media: results, total: results.length, message: results.length > 0 ? 'Found matching media. Use send_media with the URLs above.' : 'No matching media found.' })
              });
              toolExecutionContext.push(`[R${currentRound}] search_media found ${results.length} results`);
            } catch (searchErr) {
              console.error('[TOOL-LOOP-SEARCH] Error:', searchErr);
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Media search failed' }) });
            }
          } else if (fnName === 'search_knowledge') {
            console.log(`[TOOL-LOOP] Round ${currentRound}: Executing search_knowledge`);
            try {
              const queryVec = await embedQuery(args.query);
              const vectorStr = `[${queryVec.join(',')}]`;
              const { data: docResults, error: docErr } = await supabase.rpc('match_documents', {
                query_embedding: vectorStr, match_company_id: company.id, match_threshold: 0.25, match_count: 3,
              });
              let results: any[] = [];
              if (!docErr && docResults && docResults.length > 0) {
                results = docResults.map((d: any) => ({ filename: d.filename, content: d.parsed_content?.substring(0, 800) || '', similarity: d.similarity }));
              }
              let quickRef = '';
              if (results.length === 0 && company.quick_reference_info) quickRef = company.quick_reference_info;
              toolResults.push({
                tool_call_id: toolCall.id, role: "tool",
                content: JSON.stringify({ success: true, documents: results, quick_reference: quickRef || undefined, message: results.length > 0 ? 'Found relevant knowledge base content.' : (quickRef ? 'No document matches but quick reference info available.' : 'No matching knowledge base content found.') })
              });
              toolExecutionContext.push(`[R${currentRound}] search_knowledge found ${results.length} documents`);
            } catch (error) {
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Knowledge search failed' }) });
            }
          } else if (fnName === 'notify_boss') {
            console.log(`[TOOL-LOOP] Round ${currentRound}: Executing notify_boss`);
            try {
              await supabase.from('boss_conversations').insert({
                company_id: company.id, message_from: 'ai_agent',
                message_content: `[${args.notification_type}] ${args.summary}\n${args.details || ''}`,
              });
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: true, message: 'Boss notified successfully' }) });
              toolExecutionContext.push(`[R${currentRound}] notify_boss: ${args.notification_type}`);
            } catch (err) {
              toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: false, error: 'Notification failed' }) });
            }
          } else {
            // Fallback for any other non-BMS tools
            console.log(`[TOOL-LOOP] Round ${currentRound}: Generic execution for ${fnName}`);
            toolResults.push({ tool_call_id: toolCall.id, role: "tool", content: JSON.stringify({ success: true, message: `Tool ${fnName} executed in round ${currentRound}` }) });
          }
          anyToolExecuted = true;
        }

        // Snapshot this round's tool results into the cumulative buffer (used by final synthesis)
        for (const tr of toolResults) {
          allToolResults.push({ ...tr, fn: (currentToolCalls || []).find((c: any) => c.id === tr.tool_call_id)?.function?.name });
        }

      } catch (toolLoopError) {
        console.error(`[TOOL-LOOP] Error in round ${currentRound}:`, toolLoopError);
        if (!assistantReply) assistantReply = "Got it! What else can I help you with?";
        break;
      }
    }
    
    // Payment link safety net: if checkout tools succeeded and a payment_url exists in context, ensure it's in the reply
    if (toolExecutionContext.some(c => c.includes('payment link generated')) && assistantReply) {
      // Check if any tool result contains a payment URL
      const paymentUrlMatch = toolExecutionContext.find(c => c.includes('payment link'));
      if (paymentUrlMatch && !assistantReply.includes('http') && !assistantReply.includes('lenco')) {
        console.log('[PAYMENT-GUARD] Reply missing payment URL, checking tool results...');
        // The payment URL should already be in the AI reply from the multi-round loop
        // This is a safety log; the multi-round loop should handle it
      }
    }

    // Ensure we have a response — synthesize from actual tool results instead of generic placeholder
    if (!assistantReply || assistantReply.trim() === '') {
      if (anyToolExecuted && toolExecutionContext.length > 0) {
        // ========== DETERMINISTIC SYNTHESIS FROM TOOL RESULTS ==========
        // Tool calls succeeded but the model returned empty text. Build a real reply from toolResults
        // so the customer sees the data instead of "I've processed your request".
        let synthesized = '';
        try {
          const ctxJoined = toolExecutionContext.join(' | ').toLowerCase();
          const sentMedia = /send_media:\s*(\d+)\/\d+/.exec(ctxJoined);
          const mediaSentCount = sentMedia ? parseInt(sentMedia[1], 10) : 0;

          // Pull product/stock data out of toolResults JSON payloads
          const products: Array<{ name: string; price?: string | number; stock?: any }> = [];
          for (const tr of toolResults) {
            try {
              const payload = typeof tr.content === 'string' ? JSON.parse(tr.content) : tr.content;
              const candidates = payload?.products || payload?.items || payload?.results || (payload?.product ? [payload.product] : []);
              if (Array.isArray(candidates)) {
                for (const p of candidates.slice(0, 5)) {
                  const name = p?.name || p?.product_name || p?.title;
                  const price = p?.price ?? p?.unit_price ?? p?.selling_price;
                  if (name) products.push({ name: String(name), price, stock: p?.stock ?? p?.quantity });
                }
              }
            } catch { /* skip non-JSON */ }
          }
          const currency = company.currency_prefix || 'K';
          const dedupeProducts = Array.from(new Map(products.map(p => [p.name.toLowerCase(), p])).values()).slice(0, 5);

          if (mediaSentCount > 0 && dedupeProducts.length > 0) {
            const lines = dedupeProducts.map(p => p.price != null ? `• *${p.name}* — ${currency}${p.price}` : `• *${p.name}*`).join('\n');
            synthesized = `Here's what I found:\n${lines}\n\nPhotos sent above 👆 — which one catches your eye?`;
          } else if (mediaSentCount > 0) {
            synthesized = `Photos sent above 👆 — let me know which one you like and I'll get you the details.`;
          } else if (dedupeProducts.length > 0) {
            const lines = dedupeProducts.map(p => p.price != null ? `• *${p.name}* — ${currency}${p.price}` : `• *${p.name}*`).join('\n');
            synthesized = `Here's what I found:\n${lines}\n\nWant a photo of any of these?`;
          } else if (toolExecutionContext.some(c => /notify_boss|boss notified/i.test(c))) {
            synthesized = `Got it — I've flagged this for the owner who'll reach out shortly. 🙏`;
          }
        } catch (synthErr) {
          console.warn('[SYNTHESIS-FALLBACK] Error building deterministic reply:', synthErr);
        }

        if (synthesized) {
          assistantReply = synthesized;
          console.log('[SYNTHESIS-FALLBACK] Built deterministic reply from tool results:', synthesized.slice(0, 120));
        } else {
          // Last resort: at least say WHAT we did instead of "processed"
          const summary = toolExecutionContext.slice(-3).join(', ');
          assistantReply = `Just checked on that for you — ${summary}. Anything else you'd like to know?`;
          console.log('[SYNTHESIS-FALLBACK] No structured data, using context summary. Context:', toolExecutionContext);
        }
      } else {
        const lowerUserMsg = userMessage.toLowerCase();
        const isPurchaseIntent = /buy|purchase|order|payment link|pay|price/i.test(lowerUserMsg);
        if (isPurchaseIntent) {
          assistantReply = "I'd love to help you with your purchase! Could you let me know which product you're interested in? I can then provide you with the details and payment link.";
        } else {
          assistantReply = fallbackMessage || "Thank you for your message. How can I help you today?";
        }
        console.log('[FALLBACK] No AI response generated, using contextual fallback');
      }
    }

    // ========== RESPONSE VALIDATION LAYER ==========
    // Validate response doesn't contain patterns that violate business type rules
    // Note: isSchool, isRestaurant, isDigitalProducts already defined above in the business identity section
    
    // Behavior drift detection logging
    const responseAnalysis = {
      businessType: company.business_type || 'unknown',
      hasPaymentPatterns: /Send payment to|upload proof of payment|I'll process your order|payment confirmation|💰\s*Amount:|Make payment to|Pay using/i.test(assistantReply),
      hasReservationPatterns: /book|reserve|reservation/i.test(assistantReply),
      hasProductDeliveryPatterns: /deliver|sending your|download link|product has been sent/i.test(assistantReply),
      responseLength: assistantReply.length
    };
    
    console.log('[BEHAVIOR-ANALYSIS]', JSON.stringify(responseAnalysis));
    
    // Alert and fix if behavior doesn't match business type
    if (isSchool && responseAnalysis.hasPaymentPatterns) {
      console.warn('[BEHAVIOR-DRIFT] ⚠️ School business generated payment-style response! Replacing with appropriate response.');
      
      // Log to ai_error_logs for monitoring
      await supabase.from('ai_error_logs').insert({
        company_id: company.id,
        conversation_id: conversationId,
        error_type: 'behavior_drift',
        severity: 'warning',
        original_message: userMessage,
        ai_response: assistantReply,
        analysis_details: {
          detected_issue: 'payment_pattern_in_school_response',
          business_type: company.business_type,
          pattern_detected: responseAnalysis.hasPaymentPatterns,
          corrective_action: 'response_replaced'
        },
        auto_flagged: true
      });
      
      // Replace with appropriate school response
      const schoolFallback = company.payment_instructions 
        ? `Thank you for your inquiry! Here's the fee information:\n\n${company.payment_instructions}\n\nFor enrollment and payments, please visit our school office where our staff will assist you. 🏫`
        : `Thank you for your inquiry! For detailed information about fees and enrollment, please visit our school office or contact us directly. Our team will be happy to assist you with the registration process. 🏫`;
      
      assistantReply = schoolFallback;
    }

    // Check for [HANDOFF_REQUIRED] tag
    const handoffRequired = assistantReply.includes('[HANDOFF_REQUIRED]');

    if (handoffRequired) {
      console.log('[HANDOFF] Detected [HANDOFF_REQUIRED] tag - initiating handoff sequence');
      
      // Step 1: Remove tag from customer-facing message
      assistantReply = assistantReply.replace(/\[HANDOFF_REQUIRED\]/g, '').trim();
      
      // Step 2: Mute AI for this client
      await supabase
        .from('conversations')
        .update({ 
          is_paused_for_human: true,
          human_takeover: true,
          takeover_at: new Date().toISOString()
        })
        .eq('id', conversationId);
      
      console.log('[HANDOFF] Conversation muted for AI, marked for human takeover');
      
      // Step 3: Generate 3-bullet summary
      const conversationSummary = await generateConversationSummary(conversationId, supabase);
      
      // Step 4: Determine which agent triggered handoff
      const handoffAgent = selectedAgent === 'support' ? 'support_agent' : 'sales_agent';
      
      // Step 5: Notify Boss with agent information
      await sendBossHandoffNotification(
        company,
        customerPhone,
        conversation.customer_name || 'Unknown',
        conversationSummary,
        supabase,
        handoffAgent
      );
      
      // Trigger post-handoff mini-briefing
      try {
        await supabase.functions.invoke('daily-briefing', {
          body: {
            triggerType: 'handoff',
            conversationId: conversationId,
            companyId: company.id
          }
        });
        console.log('[HANDOFF] Post-handoff briefing triggered');
      } catch (briefingError) {
        console.error('[HANDOFF] Error triggering handoff briefing:', briefingError);
      }
      
      // Step 6: Log handoff to agent_performance
      await supabase
        .from('agent_performance')
        .insert({
          company_id: companyId,
          conversation_id: conversationId,
          agent_type: selectedAgent,
          handoff_occurred: true,
          handoff_reason: 'Agent detected need for human intervention via [HANDOFF_REQUIRED]',
          notes: `${selectedAgent} agent escalated to boss`
        });
      
      console.log(`[HANDOFF] Boss notified - handoff triggered by ${selectedAgent} agent`);
    }

    console.log('[BACKGROUND] Final reply:', assistantReply);

    // ========== FRUSTRATION SIGNAL DETECTION ==========
    try {
      await detectFrustrationSignals(conversationId, company, customerPhone, userMessage, supabase);
    } catch (frustErr) {
      console.error('[FRUSTRATION-DETECT] Error:', frustErr);
    }

    // Insert assistant message
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: assistantReply
      });

    // Update conversation transcript
    const updatedTranscript = `${conversation.transcript}\nCustomer: ${userMessage}\nAssistant: ${assistantReply}\n`;
    await supabase
      .from('conversations')
      .update({ transcript: updatedTranscript })
      .eq('id', conversationId);

    // Send response via Twilio API
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
        ? company.whatsapp_number 
        : `whatsapp:${company.whatsapp_number}`;

      const formData = new URLSearchParams();
      formData.append('From', fromNumber);
      formData.append('To', normalizeWhatsAppTo(customerPhone));
      formData.append('Body', assistantReply);

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (twilioResponse.ok) {
        console.log('[BACKGROUND] Response sent successfully via Twilio');
        markResponseSent();
      } else {
        const errorText = await twilioResponse.text();
        console.error('[BACKGROUND] Twilio send error:', twilioResponse.status, errorText);
      }
    }

  } catch (error) {
    console.error('[BACKGROUND] Error processing AI response:', error);
    // The outer watchdog (processAIResponse) handles fallback via finally block
    try {
      await supabase.from('ai_error_logs').insert({
        company_id: companyId,
        conversation_id: conversationId,
        error_type: 'processing_crash',
        severity: 'high',
        original_message: userMessage?.substring(0, 500) || 'N/A',
        ai_response: String(error)?.substring(0, 500),
        status: 'new'
      });
    } catch (logErr) {
      console.error('[ERROR] Failed to log error:', logErr);
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Guard: only accept form-data from Twilio webhooks
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('form') && req.method === 'POST') {
      // Non-form requests (JSON status callbacks, etc.) - acknowledge silently
      console.log('[SKIP] Non-form-data request, content-type:', contentType);
      return new Response('OK', { status: 200, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse Twilio WhatsApp webhook payload
    const formData = await req.formData();
    const From = formData.get('From') as string;
    const To = formData.get('To') as string;
    const Body = formData.get('Body') as string || '';
    const ProfileName = formData.get('ProfileName') as string || '';
    
    // Extract media information
    const NumMedia = parseInt(formData.get('NumMedia') as string || '0');
    const mediaFiles: Array<{ url: string; contentType: string }> = [];
    
    for (let i = 0; i < NumMedia; i++) {
      const mediaUrl = formData.get(`MediaUrl${i}`) as string;
      const mediaContentType = formData.get(`MediaContentType${i}`) as string;
      if (mediaUrl && mediaContentType) {
        mediaFiles.push({ url: mediaUrl, contentType: mediaContentType });
      }
    }

    // Validate input
    const messageSchema = z.object({
      From: z.string().min(1).max(255),
      To: z.string().min(1).max(255),
      Body: z.string().max(4096)
    });

    try {
      messageSchema.parse({ From, To, Body });
    } catch (error) {
      console.error('Invalid input:', error);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Invalid message format.]]></Message>
</Response>`, {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    console.log('WhatsApp message received:', { From, To, Body });

    // === CHECK FOR ONBOARDING KEYWORDS ===
    const onboardingKeywords = ['ONBOARD', 'SETUP', 'REGISTER', 'START SETUP', 'NEW COMPANY'];
    const isOnboardingRequest = onboardingKeywords.some(keyword => 
      Body.trim().toUpperCase().includes(keyword)
    );

    if (isOnboardingRequest) {
      console.log('[ONBOARDING] Detected onboarding keyword, redirecting to onboarding flow');
      
      const customerPhone = From.replace('whatsapp:', '');
      
      // Call onboarding function
      try {
        const onboardingResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-onboarding`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              phone: customerPhone,
              message: Body
            }),
          }
        );

        const onboardingResult = await onboardingResponse.json();
        
        // Return TwiML response with onboarding message
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${onboardingResult.response || 'Onboarding started!'}]]></Message>
</Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      } catch (onboardingError) {
        console.error('[ONBOARDING] Error calling onboarding function:', onboardingError);
        // Continue with regular message processing if onboarding fails
      }
    }

    // === REGULAR MESSAGE PROCESSING BELOW ===

    // Look up company by WhatsApp number — STRICT exact match only.
    // Substring/digit-fallback lookups were removed because they could match the wrong
    // tenant when phone numbers shared digit suffixes, leaking customer messages
    // across companies. We fail closed if no exact match is found.
    const stripped = To.replace(/^whatsapp:/i, '');
    const digitsOnly = stripped.replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '');
    const plusForm = digitsOnly.startsWith('+') ? digitsOnly : `+${digitsOnly}`;
    const waForm = `whatsapp:${plusForm}`;

    // Match any of the canonical forms exactly. Do NOT use ilike '%digits%'.
    const { data: matches, error: companyError } = await supabase
      .from('companies')
      .select('*, metadata')
      .or(`whatsapp_number.eq.${To},whatsapp_number.eq.${stripped},whatsapp_number.eq.${plusForm},whatsapp_number.eq.${waForm}`);

    let company: any = null;
    if (matches && matches.length === 1) {
      company = matches[0];
    } else if (matches && matches.length > 1) {
      // Ambiguity = security event. Refuse to guess.
      console.error('[COMPANY-LOOKUP][SECURITY] Multiple companies matched inbound To=', To, 'matches=', matches.map((m: any) => m.id));
      try {
        await supabase.from('cross_tenant_audit').insert({
          source: 'whatsapp-messages.inbound',
          decision: 'blocked',
          reason: 'ambiguous_inbound_number',
          customer_phone: From,
          details: { to: To, candidate_company_ids: matches.map((m: any) => m.id) }
        });
      } catch (_) { /* best effort */ }
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message><![CDATA[This number is not configured. Please contact support.]]></Message></Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    if (!company) {
      console.error('[COMPANY-LOOKUP] No exact-match company for To:', To);
      try {
        await supabase.from('cross_tenant_audit').insert({
          source: 'whatsapp-messages.inbound',
          decision: 'blocked',
          reason: 'no_company_for_inbound_number',
          customer_phone: From,
          details: { to: To }
        });
      } catch (_) { /* best effort */ }
    }

    if (companyError) {
      console.error('Database error:', companyError);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Our service is temporarily unavailable. Please try again later.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    if (!company) {
      console.error('Company not found for:', To);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[This WhatsApp number is not configured. Please contact support.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // ── DEMO MODE INTERCEPT ──
    const DEMO_NUMBER = '+13345083612';
    const companyWhatsApp = (company.whatsapp_number || '').replace('whatsapp:', '');
    if (companyWhatsApp === DEMO_NUMBER) {
      console.log(`[DEMO-ROUTE] Demo number detected, routing to demo-session. From=${From}`);
      try {
        const demoResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/demo-session`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: From,
            body: Body,
            company_id: company.id,
            boss_phone: company.boss_phone,
            profile_name: ProfileName,
          }),
        });

        const demoData = await demoResponse.json();
        const demoReply = demoData.reply || 'Demo service temporarily unavailable.';

        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${demoReply}]]></Message>
</Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
        });
      } catch (demoError) {
        console.error('[DEMO-ROUTE] Error calling demo-session:', demoError);
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Demo service temporarily unavailable. Please try again.]]></Message>
</Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
        });
      }
    }

    // Detect WhatsApp Flow Response
    if (Body.includes('__flow_response__')) {
      console.log('[FLOW-RESPONSE] Detected flow submission');
      
      try {
        // Parse the flow response data
        const flowData = JSON.parse(Body.replace('__flow_response__', ''));
        const flowType = flowData.flow_type;
        
        console.log('[FLOW-RESPONSE] Flow data:', JSON.stringify(flowData));
        
        // Find or create conversation
        const customerPhone = From;
        let conversationId: string;
        
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('phone', customerPhone)
          .eq('company_id', company.id)
          .eq('status', 'active')
          .maybeSingle();
        
        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              phone: customerPhone,
              company_id: company.id,
              customer_name: flowData.customer_name || 'Customer',
              status: 'active'
            })
            .select('id')
            .single();
          conversationId = newConv!.id;
        }
        
        if (flowType === 'reservation') {
          // Create reservation from flow data
          const { error: resError } = await supabase
            .from('reservations')
            .insert({
              conversation_id: conversationId,
              company_id: company.id,
              name: flowData.customer_name,
              phone: flowData.phone,
              email: flowData.email || null,
              date: flowData.date,
              time: flowData.time,
              guests: parseInt(flowData.guests),
              occasion: flowData.occasion || null,
              area_preference: flowData.area_preference || null,
              branch: flowData.branch || null,
              status: 'confirmed'
            });
          
          if (resError) {
            console.error('[FLOW-RESPONSE] Reservation creation error:', resError);
            return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, there was an error processing your reservation. Please try again.]]></Message>
</Response>`, {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
            });
          }
          
          // Send confirmation
          const confirmMsg = `🎉 *Reservation Confirmed!*\n\n✅ Name: ${flowData.customer_name}\n📅 Date: ${flowData.date}\n🕐 Time: ${flowData.time}\n👥 Guests: ${flowData.guests}\n\nWe look forward to seeing you!`;
          
          return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${confirmMsg}]]></Message>
</Response>`, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
          });
          
        } else if (flowType === 'payment') {
          // Create payment transaction from flow data
          const { error: payError } = await supabase
            .from('payment_transactions')
            .insert({
              company_id: company.id,
              conversation_id: conversationId,
              customer_name: flowData.customer_name,
              customer_phone: flowData.phone,
              amount: parseFloat(flowData.amount || '0'),
              currency: company.currency_prefix || 'ZMW',
              payment_method: flowData.payment_method,
              payment_status: 'pending'
            });
          
          if (payError) {
            console.error('[FLOW-RESPONSE] Payment creation error:', payError);
            return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, there was an error processing your payment. Please try again.]]></Message>
</Response>`, {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
            });
          }
          
          // Notify boss
          if (company.boss_phone) {
            const bossMsg = `💰 *Payment Request*\n\nCustomer: ${flowData.customer_name}\nPhone: ${flowData.phone}\nEmail: ${flowData.email || 'Not provided'}\nMethod: ${flowData.payment_method}\nAmount: ${company.currency_prefix}${flowData.amount || 'TBD'}`;
            
            const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
            
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const notifFormData = new URLSearchParams();
            notifFormData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
            notifFormData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
            notifFormData.append('Body', bossMsg);
            
            await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: notifFormData.toString(),
            });
          }
          
          // Send confirmation to customer
          const confirmMsg = `✅ *Payment Information Received*\n\nThank you ${flowData.customer_name}! Our team will contact you shortly with payment instructions.`;
          
          return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${confirmMsg}]]></Message>
</Response>`, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
          });
        }
        
      } catch (error) {
        console.error('[FLOW-RESPONSE] Error processing flow:', error);
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, there was an error processing your form. Please try again.]]></Message>
</Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
    }

    // Check if message is from boss or takeover number
    const normalizePhone = (phone: string) => {
      return phone.replace(/^whatsapp:/i, '').replace(/\+/g, '').replace(/\s/g, '');
    };
    
    const fromPhone = normalizePhone(From);
    const bossPhone = company.boss_phone ? normalizePhone(company.boss_phone) : '';
    const takeoverPhone = company.takeover_number ? normalizePhone(company.takeover_number) : '';
    
    console.log('Phone comparison:', { fromPhone, bossPhone, takeoverPhone, isBoss: fromPhone === bossPhone, isTakeover: fromPhone === takeoverPhone });
    
    // Handle message from takeover number - conversation selector
    if (company.takeover_number && fromPhone === takeoverPhone) {
      console.log('Message from TAKEOVER NUMBER - checking session');
      
      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
      
      // Clean up expired sessions
      await supabase
        .from('takeover_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString());
      
      // Check for existing session
      const { data: session } = await supabase
        .from('takeover_sessions')
        .select('*')
        .eq('company_id', company.id)
        .eq('takeover_phone', fromPhone)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      
      // Check if message is a numeric selection (1, 2, 3, etc.)
      const numericSelection = parseInt(Body.trim());
      const isNumericSelection = !isNaN(numericSelection) && numericSelection > 0;
      
      // Get active conversations with human takeover
      const { data: activeConvs } = await supabase
        .from('conversations')
        .select('id, customer_name, phone, started_at, last_message_preview')
        .eq('company_id', company.id)
        .eq('status', 'active')
        .eq('human_takeover', true)
        .order('started_at', { ascending: false })
        .limit(10);
      
      // If numeric selection, update session
      if (isNumericSelection && activeConvs && activeConvs.length >= numericSelection) {
        const selectedConv = activeConvs[numericSelection - 1];
        
        // Update or create session
        await supabase
          .from('takeover_sessions')
          .upsert({
            company_id: company.id,
            takeover_phone: fromPhone,
            selected_conversation_id: selectedConv.id,
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
          }, {
            onConflict: 'company_id,takeover_phone'
          });
        
        // Send confirmation
        if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
          const confirmMessage = `✅ Now responding to: ${selectedConv.customer_name || 'Unknown'} (${selectedConv.phone?.replace('whatsapp:', '')})\n\nSend your message to reply to this customer.`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const twilioFormData = new URLSearchParams();
          twilioFormData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
          twilioFormData.append('To', From);
          twilioFormData.append('Body', confirmMessage);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: twilioFormData
          });
        }
        
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
      
      // If no session or asking for menu, show conversation list
      if (!session || Body.toLowerCase().includes('menu') || Body.toLowerCase().includes('list')) {
        if (!activeConvs || activeConvs.length === 0) {
          // No active conversations
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const noConvsMessage = `No active conversations in takeover mode.\n\nTo start managing a conversation:\n1. Go to your dashboard\n2. Select a conversation\n3. Click "Take Over"\n4. You'll receive messages here`;
            
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const twilioFormData = new URLSearchParams();
            twilioFormData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
            twilioFormData.append('To', From);
            twilioFormData.append('Body', noConvsMessage);
            
            await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioFormData
            });
          }
        } else {
          // Show menu of active conversations
          let menuMessage = `📱 *Active Conversations*\n\nReply with a number to select:\n\n`;
          
          activeConvs.forEach((conv, index) => {
            const customerDisplay = conv.customer_name || 'Unknown';
            const phoneDisplay = conv.phone?.replace('whatsapp:', '') || 'N/A';
            const preview = conv.last_message_preview ? `\n   "${conv.last_message_preview.substring(0, 60)}..."` : '';
            menuMessage += `*${index + 1}.* ${customerDisplay}\n   ${phoneDisplay}${preview}\n\n`;
          });
          
          menuMessage += `Send "menu" anytime to see this list again.`;
          
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const twilioFormData = new URLSearchParams();
            twilioFormData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
            twilioFormData.append('To', From);
            twilioFormData.append('Body', menuMessage);
            
            await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioFormData
            });
          }
        }
        
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
      
      // If session exists, forward message to selected conversation
      if (session && session.selected_conversation_id) {
        const { data: conversation } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', session.selected_conversation_id)
          .single();
        
        if (conversation) {
          // Enable takeover mode if not already
          if (!conversation.human_takeover) {
            await supabase
              .from('conversations')
              .update({ 
                human_takeover: true,
                takeover_at: new Date().toISOString()
              })
              .eq('id', conversation.id);
          }
          
          // Store boss message
          await supabase
            .from('messages')
            .insert({
              conversation_id: conversation.id,
              role: 'assistant',
              content: Body
            });
          
          // Update session expiry
          await supabase
            .from('takeover_sessions')
            .update({
              expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
            })
            .eq('id', session.id);
          
          // Forward to customer
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const twilioFormData = new URLSearchParams();
            twilioFormData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
            twilioFormData.append('To', conversation.phone);
            twilioFormData.append('Body', Body);
            
            const twilioResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioFormData
            });
            
            if (twilioResponse.ok) {
              console.log('[TAKEOVER] Message forwarded to customer');
            } else {
              const errorText = await twilioResponse.text();
              console.error('[TAKEOVER] Failed to forward:', twilioResponse.status, errorText);
            }
          }
        }
      }
      
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
      });
    }
    
    if (company.boss_phone && fromPhone === bossPhone) {
      console.log('Message from BOSS - Wake Up Routine + Command Handler');
      
      // Update admin_last_active to open 24-hour service window
      await supabase
        .from('companies')
        .update({ 
          admin_last_active: new Date().toISOString() 
        })
        .eq('id', company.id);
      
      console.log('[WAKE-UP] Boss activity logged, 24-hour service window active');
      
      // Check for "Unmute" command
      const trimmedBody = Body.trim().toLowerCase();
      
      if (trimmedBody === 'unmute' || trimmedBody.startsWith('unmute')) {
        console.log('[UNMUTE] Boss requesting to unmute a client');
        
        // Extract phone number if provided (e.g., "Unmute +260977123456")
        const phoneMatch = Body.match(/\+?\d{10,15}/);
        let targetPhone = phoneMatch ? phoneMatch[0] : null;
        
        if (!targetPhone) {
          // If no phone provided, get the most recent paused conversation
          const { data: recentPaused } = await supabase
            .from('conversations')
            .select('id, customer_name, phone')
            .eq('company_id', company.id)
            .eq('is_paused_for_human', true)
            .order('takeover_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (recentPaused) {
            targetPhone = recentPaused.phone;
          }
        }
        
        const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
        const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
        
        if (targetPhone) {
          // Normalize phone
          const normalizedTarget = targetPhone.replace(/[^\d]/g, '');
          
          // Unmute all conversations for this customer
          console.log(`[UNMUTE] 🔓 Boss manually unpausing conversations for ${targetPhone}`);
          
          const { data: unmuteResult } = await supabase
            .from('conversations')
            .update({ 
              is_paused_for_human: false,
              human_takeover: false
            })
            .eq('company_id', company.id)
            .eq('phone', `whatsapp:+${normalizedTarget}`)
            .select();
          
          console.log(`[UNMUTE] ✓ Unmuted ${unmuteResult?.length || 0} conversation(s) for ${targetPhone}`);
          console.log('[UNMUTE] Updated conversations:', unmuteResult?.map(c => c.id));
          
          // Send confirmation to Boss
          const confirmMsg = `✅ AI resumed for ${targetPhone}. Future messages will be handled automatically.`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
          formData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
          formData.append('Body', confirmMsg);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });
        } else {
          // No client found to unmute
          const errorMsg = `❌ No paused clients found. Please specify phone number: "Unmute +260977123456"`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append('From', normalizeWhatsAppFrom(company.whatsapp_number));
          formData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
          formData.append('Body', errorMsg);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });
        }
        
        // Return empty TwiML after unmute command
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
        });
      }
      
      // Check if message contains reservation command (APPROVE/REJECT/SUGGEST)
      const upperBody = Body.toUpperCase();
      if (upperBody.includes('APPROVE') || upperBody.includes('REJECT') || upperBody.includes('SUGGEST')) {
        console.log('[BOSS-WEBHOOK] Boss reservation command detected, routing to handler');
        
        // @ts-ignore - EdgeRuntime is a Deno Deploy global
        EdgeRuntime.waitUntil(
          (async () => {
            try {
              const { data: responseData, error: responseError } = await supabase.functions.invoke('handle-boss-response', {
                body: {
                  bossPhone: From,
                  messageBody: Body,
                  companyId: company.id
                }
              });
              
              if (responseError) {
                console.error('[BOSS-WEBHOOK] Error handling boss response:', responseError);
              } else {
                console.log('[BOSS-WEBHOOK] Boss response handled successfully');
              }
            } catch (error) {
              console.error('[BOSS-WEBHOOK] Exception handling boss response:', error);
            }
          })()
        );
        
        // Return empty TwiML - customer already notified by handler
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
      
      // boss_conversations insert is handled by boss-chat function (with AI response)
      
      // Start background processing
      // @ts-ignore - EdgeRuntime is a Deno Deploy global
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            // Send instant ⏳ ack so boss knows message was received
            const TWILIO_SID_ACK = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_TOKEN_ACK = Deno.env.get('TWILIO_AUTH_TOKEN');
            if (TWILIO_SID_ACK && TWILIO_TOKEN_ACK) {
              const ackForm = new URLSearchParams();
              ackForm.append('From', To);
              ackForm.append('To', From);
              ackForm.append('Body', '⏳');
              // Fire-and-forget — don't await
              fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID_ACK}/Messages.json`, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + btoa(`${TWILIO_SID_ACK}:${TWILIO_TOKEN_ACK}`),
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: ackForm.toString(),
              }).catch(e => console.error('[BOSS] Ack send error:', e));
            }

            console.log('[BOSS] Calling boss-chat function');
            
            // Call boss-chat function
            const { data: bossData, error: bossError } = await supabase.functions.invoke('boss-chat', {
              body: { From, Body, ProfileName: formData.get('ProfileName'), companyId: company.id }
            });
            
            if (bossError || !bossData?.response) {
              console.error('[BOSS] Boss chat error:', bossError);
              throw new Error('Boss chat failed');
            }
            
            console.log('[BOSS] Got response from boss-chat, sending via Twilio');
            
            const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
            
            // Clean formatting function - removes markdown and organizes text
            const cleanFormatting = (text: string): string => {
              return text
                // Remove markdown bold
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                // Remove markdown italic
                .replace(/\*([^*]+)\*/g, '$1')
                // Remove markdown headers
                .replace(/^#+\s+/gm, '')
                // Clean up excessive newlines
                .replace(/\n{3,}/g, '\n\n')
                // Trim whitespace
                .trim();
            };
            
            // Split message into chunks if too long
            const splitMessage = (text: string, maxLength: number = 1500): string[] => {
              if (text.length <= maxLength) return [text];
              
              const chunks: string[] = [];
              let remaining = text;
              
              while (remaining.length > 0) {
                if (remaining.length <= maxLength) {
                  chunks.push(remaining);
                  break;
                }
                
                // Find last period, question mark, or newline before maxLength
                let splitIndex = remaining.lastIndexOf('.', maxLength);
                if (splitIndex === -1) splitIndex = remaining.lastIndexOf('?', maxLength);
                if (splitIndex === -1) splitIndex = remaining.lastIndexOf('\n', maxLength);
                if (splitIndex === -1) splitIndex = maxLength;
                
                chunks.push(remaining.substring(0, splitIndex + 1).trim());
                remaining = remaining.substring(splitIndex + 1).trim();
              }
              
              return chunks;
            };
            
            // Helper: track boss media delivery
            const trackBossMedia = async (imageUrl: string, context: string) => {
              try {
                const { data: trackRow } = await supabase.from('boss_media_deliveries').insert({
                  company_id: company.id,
                  boss_phone: From,
                  image_url: imageUrl,
                  context,
                  status: 'pending',
                }).select('id').single();
                return trackRow?.id || null;
              } catch (e) {
                console.error('[BOSS] Failed to track media delivery:', e);
                return null;
              }
            };

            const updateTrack = async (trackId: string | null, status: string, twilioSid?: string, errorMsg?: string) => {
              if (!trackId) return;
              try {
                await supabase.from('boss_media_deliveries').update({
                  status,
                  ...(twilioSid ? { twilio_sid: twilioSid } : {}),
                  ...(errorMsg ? { error_message: errorMsg } : {}),
                  updated_at: new Date().toISOString(),
                }).eq('id', trackId);
              } catch (e) {
                console.error('[BOSS] Failed to update media track:', e);
              }
            };

            // Check if boss-chat returned a mediaMessages array (multi-image posts)
            if (bossData.mediaMessages && Array.isArray(bossData.mediaMessages) && bossData.mediaMessages.length > 0) {
              console.log(`[BOSS] Sending ${bossData.mediaMessages.length} individual media message(s)`);
              
              for (let i = 0; i < bossData.mediaMessages.length; i++) {
                const item = bossData.mediaMessages[i];
                const cleanedBody = cleanFormatting(item.body);
                const bodyChunks = splitMessage(cleanedBody);
                
                // Track media delivery if this item has an image
                let trackId: string | null = null;
                if (item.imageUrl) {
                  trackId = await trackBossMedia(item.imageUrl, 'media_message');
                }
                
                for (let c = 0; c < bodyChunks.length; c++) {
                  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
                  const twilioFormData = new URLSearchParams();
                  twilioFormData.append('From', To);
                  twilioFormData.append('To', From);
                  twilioFormData.append('Body', bodyChunks[c]);
                  
                  // Attach image only to first chunk of this media item
                  if (c === 0 && item.imageUrl) {
                    console.log(`[BOSS] Media msg ${i+1}: attaching image ${item.imageUrl.substring(0, 80)}...`);
                    twilioFormData.append('MediaUrl', item.imageUrl);
                  }
                  
                  const twilioResponse = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                      'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                      'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: twilioFormData
                  });
                  
                  if (twilioResponse.ok) {
                    console.log(`[BOSS] Media msg ${i+1} chunk ${c+1}/${bodyChunks.length} sent`);
                    // Update tracking on the first chunk (where image is attached)
                    if (c === 0 && trackId) {
                      const twilioData = await twilioResponse.clone().json().catch(() => null);
                      await updateTrack(trackId, 'sent', twilioData?.sid);
                    }
                  } else {
                    const errorText = await twilioResponse.text();
                    console.error(`[BOSS] Failed media msg ${i+1} chunk ${c+1}:`, twilioResponse.status, errorText);
                    if (c === 0 && trackId) {
                      await updateTrack(trackId, 'failed', undefined, `Twilio ${twilioResponse.status}: ${errorText.substring(0, 200)}`);
                    }
                  }
                  
                  // Delay between chunks/messages
                  if (c < bodyChunks.length - 1 || i < bossData.mediaMessages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                  }
                }
              }
            } else {
              // Standard single-image chunk logic
              const cleanedResponse = cleanFormatting(bossData.response);
              const responseChunks = splitMessage(cleanedResponse);
              console.log(`[BOSS] Sending ${responseChunks.length} message chunk(s)`);
              console.log(`[BOSS] Has imageUrl: ${!!bossData.imageUrl}`);

              // Track single image delivery
              let trackId: string | null = null;
              if (bossData.imageUrl) {
                trackId = await trackBossMedia(bossData.imageUrl, 'single_image');
              }
              
              for (let i = 0; i < responseChunks.length; i++) {
                const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
                const twilioFormData = new URLSearchParams();
                twilioFormData.append('From', To);
                twilioFormData.append('To', From);
                twilioFormData.append('Body', responseChunks[i]);
                
                if (i === 0 && bossData.imageUrl) {
                  console.log(`[BOSS] Attaching image URL to first chunk: ${bossData.imageUrl.substring(0, 80)}...`);
                  twilioFormData.append('MediaUrl', bossData.imageUrl);
                }
                
                const twilioResponse = await fetch(twilioUrl, {
                  method: 'POST',
                  headers: {
                    'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: twilioFormData
                });
                
                if (twilioResponse.ok) {
                  console.log(`[BOSS] Chunk ${i+1}/${responseChunks.length} sent successfully`);
                  if (i === 0 && trackId) {
                    const twilioData = await twilioResponse.clone().json().catch(() => null);
                    await updateTrack(trackId, 'sent', twilioData?.sid);
                  }
                } else {
                  const errorText = await twilioResponse.text();
                  console.error(`[BOSS] Failed to send chunk ${i+1}:`, twilioResponse.status, errorText);
                  if (i === 0 && trackId) {
                    await updateTrack(trackId, 'failed', undefined, `Twilio ${twilioResponse.status}: ${errorText.substring(0, 200)}`);
                  }
                }
                
                if (i < responseChunks.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
            }
          } catch (error) {
            console.error('[BOSS] Error in background processing:', error);
            // Send error recovery message instead of silence
            try {
              const TWILIO_SID_ERR = Deno.env.get('TWILIO_ACCOUNT_SID');
              const TWILIO_TOKEN_ERR = Deno.env.get('TWILIO_AUTH_TOKEN');
              if (TWILIO_SID_ERR && TWILIO_TOKEN_ERR) {
                const errForm = new URLSearchParams();
                errForm.append('From', To);
                errForm.append('To', From);
                errForm.append('Body', '⚠️ Sorry, I hit a snag processing that. Could you try again?');
                await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID_ERR}/Messages.json`, {
                  method: 'POST',
                  headers: {
                    'Authorization': 'Basic ' + btoa(`${TWILIO_SID_ERR}:${TWILIO_TOKEN_ERR}`),
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: errForm.toString(),
                });
              }
            } catch (errSend) {
              console.error('[BOSS] Failed to send error recovery message:', errSend);
            }
          }
        })()
      );
      
      // Return empty TwiML immediately
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
      });
    }

    // Customer message handling
    console.log('Processing customer message');

    // Check credit balance
    if (company.credit_balance <= 0) {
      const offlineMessage = "Our assistant is currently offline. A human will message you shortly.";
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${offlineMessage}]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    const customerPhone = From.replace('whatsapp:', '');
    
    // Find or create conversation
    let { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('company_id', company.id)
      .eq('phone', From)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Early pause check removed - routing system now manages pause state dynamically
    // Human takeover check removed - routing system now manages takeover state dynamically
    
    if (convError || !conversation) {
      console.log(`[CONVERSATION] 🆕 Creating new conversation for ${customerPhone}`);
      
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          company_id: company.id,
          phone: From,
          status: 'active',
          customer_name: ProfileName || null,
          transcript: `CUSTOMER PHONE: ${customerPhone}\nCUSTOMER NAME: ${ProfileName || 'Unknown'}\n`
        })
        .select()
        .single();

      if (createError) {
        console.error('[CONVERSATION] ❌ Error creating conversation:', createError);
        throw createError;
      }
      conversation = newConv;
      console.log(`[CONVERSATION] ✓ New conversation created with ID: ${conversation.id}`);
    } else {
      console.log(`[CONVERSATION] 📝 Using existing conversation ${conversation.id}`);
      console.log(`[CONVERSATION] Current state - Paused: ${conversation.is_paused_for_human}, Handoff: ${conversation.human_takeover}, Agent: ${conversation.active_agent || 'none'}`);
      
      // Update customer_name if missing but ProfileName is available
      if (!conversation.customer_name && ProfileName) {
        await supabase
          .from('conversations')
          .update({ customer_name: ProfileName })
          .eq('id', conversation.id);
        conversation.customer_name = ProfileName;
        console.log(`[CONVERSATION] 📛 Updated customer name to: ${ProfileName}`);
      }
    }

    // Deduct credits
    await supabase.rpc('deduct_credits', {
      p_company_id: company.id,
      p_amount: 1,
      p_reason: 'whatsapp_message',
      p_conversation_id: conversation.id
    });
    
    // Handle media files
    const storedMediaUrls: string[] = [];
    const storedMediaTypes: string[] = [];
    
    if (mediaFiles.length > 0) {
      console.log(`[MEDIA] Processing ${mediaFiles.length} media files`);
      
      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
      
      for (let i = 0; i < mediaFiles.length; i++) {
        const media = mediaFiles[i];
        console.log(`[MEDIA] Fetching media ${i}: ${media.url.substring(0, 50)}...`);
        try {
          // Twilio media URLs require authentication
          const mediaResponse = await fetch(media.url, {
            headers: TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
            } : {}
          });
          
          if (!mediaResponse.ok) {
            console.error(`[MEDIA] Fetch failed for media ${i}: ${mediaResponse.status}`);
            continue;
          }
          
          const mediaBlob = await mediaResponse.arrayBuffer();
          console.log(`[MEDIA] Downloaded media ${i}: ${mediaBlob.byteLength} bytes`);
          
          const fileExt = media.contentType.split('/')[1] || 'bin';
          const fileName = `${conversation.id}/${Date.now()}_${i}.${fileExt}`;
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('conversation-media')
            .upload(fileName, mediaBlob, {
              contentType: media.contentType,
              upsert: false
            });
          
          if (uploadError) {
            console.error(`[MEDIA] Upload error for media ${i}:`, uploadError);
            continue;
          }
          
          const { data: { publicUrl } } = supabase.storage
            .from('conversation-media')
            .getPublicUrl(fileName);
          
          storedMediaUrls.push(publicUrl);
          storedMediaTypes.push(media.contentType);
          console.log(`[MEDIA] Media ${i} stored successfully:`, publicUrl);
        } catch (error) {
          console.error(`[MEDIA] Processing error for media ${i}:`, error);
        }
      }
      console.log(`[MEDIA] Total stored: ${storedMediaUrls.length}/${mediaFiles.length}`);
    }

    // Insert user message immediately
    const messageMetadata = {
      media_urls: storedMediaUrls,
      media_types: storedMediaTypes,
      media_count: storedMediaUrls.length,
      message_type: storedMediaUrls.length > 0 
        ? (Body ? 'text_with_media' : 'media')
        : 'text'
    };
    
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: Body || (storedMediaUrls.length > 0 ? 'Sent media' : ''),
        message_metadata: messageMetadata
      });

    console.log('User message stored, starting background AI processing');

    // Start background processing - THIS IS THE KEY CHANGE
    // @ts-ignore - EdgeRuntime is a Deno Deploy global
    EdgeRuntime.waitUntil(
      processAIResponse(
        conversation.id,
        company.id,
        Body,
        storedMediaUrls,
        storedMediaTypes,
        customerPhone
      )
    );

    // Return empty TwiML response (no immediate message to customer)
    const immediateTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`;

    console.log('Returning immediate TwiML response at:', new Date().toISOString());

    return new Response(immediateTwiml, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });

  } catch (error) {
    console.error("Error in WhatsApp handler:", error);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, I encountered an error. Please try again or contact us directly.]]></Message>
</Response>`, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }
});
