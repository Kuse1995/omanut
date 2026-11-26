import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface MarketerSubscriptionRow {
  id: string;
  company_id: string;
  plan_id: string | null;
  primary_whatsapp_phone: string;
  contact_name: string | null;
  status: 'setup_pending' | 'active' | 'grace_period' | 'paused' | 'cancelled';
  currency: string;
  setup_fee_amount: number;
  setup_fee_paid: boolean;
  setup_fee_paid_at: string | null;
  monthly_fee_amount: number;
  current_period_start: string;
  current_period_end: string;
  grace_until: string | null;
  monthly_posts_limit: number;
  monthly_images_limit: number;
  monthly_videos_limit: number;
  usage_posts_used: number;
  usage_images_used: number;
  usage_videos_used: number;
  usage_reset_at: string;
  autopilot_level: 'copilot' | 'weekly_batch' | 'full_autopilot';
  weekly_kickoff_day: number;
  weekly_kickoff_hour: number;
  notes: string | null;
  provisioned_by: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Resolve a valid auth.users UUID for tables that enforce created_by / user_id NOT NULL
 * (scheduled_posts, meta_oauth_sessions, meta_credentials) without requiring Marketer-only
 * WhatsApp clients to create a Supabase dashboard login.
 */
export async function resolveEffectiveUserId(
  supabase: SupabaseClient,
  companyId: string,
  provisionedBy?: string | null
): Promise<string> {
  const { data: owner } = await supabase
    .from('company_users')
    .select('user_id')
    .eq('company_id', companyId)
    .in('role', ['owner', 'manager'])
    .limit(1)
    .maybeSingle();

  if (owner?.user_id) return owner.user_id;

  if (provisionedBy) return provisionedBy;

  const { data: sub } = await supabase
    .from('marketer_subscriptions')
    .select('provisioned_by')
    .eq('company_id', companyId)
    .maybeSingle();

  if (sub?.provisioned_by) return sub.provisioned_by;

  const { data: adminRole } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (adminRole?.user_id) return adminRole.user_id;

  throw new Error('Could not resolve an owning user_id for social operations');
}

export async function checkMarketerQuota(
  supabase: SupabaseClient,
  sub: MarketerSubscriptionRow,
  metric: 'chat' | 'post' | 'image' | 'video'
): Promise<{ allowed: boolean; reason?: string; refreshedSub: MarketerSubscriptionRow }> {
  let current = sub;

  if (current.status === 'paused' || current.status === 'cancelled') {
    return {
      allowed: false,
      reason: `Your Omanut Social Marketer subscription is currently *${current.status}*. Please send your monthly MoMo renewal (${current.currency} ${current.monthly_fee_amount}) and let us know so we can reactivate immediately!`,
      refreshedSub: current,
    };
  }

  // If expired and grace window passed -> transition cleanly to grace_period or paused
  const nowMs = Date.now();
  const periodEndMs = Date.parse(current.current_period_end);
  if (current.status === 'active' && Number.isFinite(periodEndMs) && nowMs > periodEndMs) {
    const graceMs = periodEndMs + 3 * 24 * 60 * 60 * 1000;
    const nextStatus = nowMs <= graceMs ? 'grace_period' : 'paused';
    const { data: updated } = await supabase
      .from('marketer_subscriptions')
      .update({
        status: nextStatus,
        grace_until: new Date(graceMs).toISOString(),
      })
      .eq('id', current.id)
      .select('*')
      .maybeSingle();
    if (updated) current = updated as MarketerSubscriptionRow;
    if (nextStatus === 'paused') {
      return {
        allowed: false,
        reason: `Your monthly subscription period ended and the 3-day grace window has closed. Send your ${current.currency} ${current.monthly_fee_amount} MoMo renewal and reply to reactivate!`,
        refreshedSub: current,
      };
    }
  }

  if (current.status === 'grace_period' && current.grace_until && Date.parse(current.grace_until) < nowMs) {
    const { data: updated } = await supabase
      .from('marketer_subscriptions')
      .update({ status: 'paused' })
      .eq('id', current.id)
      .select('*')
      .maybeSingle();
    if (updated) current = updated as MarketerSubscriptionRow;
    return {
      allowed: false,
      reason: `Your Omanut Social Marketer subscription is paused pending monthly renewal (${current.currency} ${current.monthly_fee_amount}). Reply once you send MoMo and we'll resume immediately!`,
      refreshedSub: current,
    };
  }

  if (metric === 'post' && current.monthly_posts_limit > 0 && current.usage_posts_used >= current.monthly_posts_limit) {
    return {
      allowed: false,
      reason: `You've used all ${current.monthly_posts_limit} scheduled/published posts included this month (${current.usage_posts_used}/${current.monthly_posts_limit}). Message your Omanut contact to top up your monthly limit!`,
      refreshedSub: current,
    };
  }

  if (metric === 'image' && current.monthly_images_limit > 0 && current.usage_images_used >= current.monthly_images_limit) {
    return {
      allowed: false,
      reason: `You've used all ${current.monthly_images_limit} AI brand image generations this month (${current.usage_images_used}/${current.monthly_images_limit}). You can still upload your own Vault photos anytime or ask for a top-up!`,
      refreshedSub: current,
    };
  }

  if (metric === 'video' && current.monthly_videos_limit > 0 && current.usage_videos_used >= current.monthly_videos_limit) {
    return {
      allowed: false,
      reason: `You've used all ${current.monthly_videos_limit} AI Reels/videos included this month (${current.usage_videos_used}/${current.monthly_videos_limit}). Upload raw video clips to your Vault anytime or request a Reel top-up!`,
      refreshedSub: current,
    };
  }

  return { allowed: true, refreshedSub: current };
}

export async function incrementMarketerUsage(
  supabase: SupabaseClient,
  subscriptionId: string,
  metric: 'post' | 'image' | 'video'
): Promise<void> {
  const col =
    metric === 'post'
      ? 'usage_posts_used'
      : metric === 'image'
      ? 'usage_images_used'
      : 'usage_videos_used';

  const { data: row } = await supabase
    .from('marketer_subscriptions')
    .select(col)
    .eq('id', subscriptionId)
    .maybeSingle();

  const currentVal = Number((row as Record<string, unknown> | null)?.[col] ?? 0);
  await supabase
    .from('marketer_subscriptions')
    .update({ [col]: currentVal + 1 })
    .eq('id', subscriptionId);
}
