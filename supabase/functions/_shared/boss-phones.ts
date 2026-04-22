import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type BossRole = 'owner' | 'manager' | 'social_media_manager' | 'accountant' | 'operations' | 'support_lead' | 'custom';

export interface BossPhone {
  id: string;
  phone: string;
  label: string | null;
  role: BossRole;
  role_label: string | null;
  is_primary: boolean;
  notify_reservations: boolean;
  notify_payments: boolean;
  notify_alerts: boolean;
  notify_social_media: boolean;
  notify_content_approval: boolean;
}

export interface BossPhoneFilter {
  notify_reservations?: boolean;
  notify_payments?: boolean;
  notify_alerts?: boolean;
  notify_social_media?: boolean;
  notify_content_approval?: boolean;
  primary_only?: boolean;
}

const SELECT_COLS = 'id, phone, label, role, role_label, is_primary, notify_reservations, notify_payments, notify_alerts, notify_social_media, notify_content_approval';

/**
 * Get all boss phones for a company, optionally filtered by notification preferences.
 * Falls back to companies.boss_phone if the new table has no entries.
 */
export async function getBossPhones(
  supabase: SupabaseClient,
  companyId: string,
  filter?: BossPhoneFilter
): Promise<BossPhone[]> {
  let query = supabase
    .from('company_boss_phones')
    .select(SELECT_COLS)
    .eq('company_id', companyId);

  if (filter?.primary_only) query = query.eq('is_primary', true);
  if (filter?.notify_reservations) query = query.eq('notify_reservations', true);
  if (filter?.notify_payments) query = query.eq('notify_payments', true);
  if (filter?.notify_alerts) query = query.eq('notify_alerts', true);
  if (filter?.notify_social_media) query = query.eq('notify_social_media', true);
  if (filter?.notify_content_approval) query = query.eq('notify_content_approval', true);

  const { data, error } = await query;

  if (error) {
    console.error('[getBossPhones] Error:', error);
  }

  if (data && data.length > 0) {
    return data as BossPhone[];
  }

  // Fallback: read from companies.boss_phone for backward compatibility.
  // Only if no filter is set (legacy phone gets all notifications).
  const noFilter = !filter || (
    !filter.notify_reservations && !filter.notify_payments && !filter.notify_alerts &&
    !filter.notify_social_media && !filter.notify_content_approval && !filter.primary_only
  );
  if (!noFilter) return [];

  const { data: company } = await supabase
    .from('companies')
    .select('boss_phone')
    .eq('id', companyId)
    .single();

  if (company?.boss_phone) {
    return [{
      id: 'legacy',
      phone: company.boss_phone,
      label: 'Owner',
      role: 'owner',
      role_label: null,
      is_primary: true,
      notify_reservations: true,
      notify_payments: true,
      notify_alerts: true,
      notify_social_media: true,
      notify_content_approval: true,
    }];
  }

  return [];
}

/**
 * Resolve which companies a boss phone number belongs to.
 * Returns company IDs, names, and the caller's role at each company.
 */
export async function resolveCompaniesForPhone(
  supabase: SupabaseClient,
  phone: string
): Promise<Array<{ company_id: string; company_name: string; role?: BossRole; role_label?: string | null }>> {
  const normalizedPhone = phone.replace(/^whatsapp:/i, '').replace(/\s/g, '');

  const { data: bossPhoneEntries } = await supabase
    .from('company_boss_phones')
    .select('company_id, role, role_label, companies(name)')
    .or(`phone.ilike.%${normalizedPhone}%`);

  if (bossPhoneEntries && bossPhoneEntries.length > 0) {
    return bossPhoneEntries.map((entry: any) => ({
      company_id: entry.company_id,
      company_name: entry.companies?.name || 'Unknown',
      role: entry.role as BossRole,
      role_label: entry.role_label,
    }));
  }

  // Fallback: search companies.boss_phone
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .ilike('boss_phone', `%${normalizedPhone}%`);

  return (companies || []).map((c: any) => ({
    company_id: c.id,
    company_name: c.name,
    role: 'owner' as BossRole,
    role_label: null,
  }));
}
