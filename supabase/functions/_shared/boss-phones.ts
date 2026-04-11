import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface BossPhone {
  id: string;
  phone: string;
  label: string | null;
  is_primary: boolean;
  notify_reservations: boolean;
  notify_payments: boolean;
  notify_alerts: boolean;
}

export interface BossPhoneFilter {
  notify_reservations?: boolean;
  notify_payments?: boolean;
  notify_alerts?: boolean;
  primary_only?: boolean;
}

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
    .select('id, phone, label, is_primary, notify_reservations, notify_payments, notify_alerts')
    .eq('company_id', companyId);

  if (filter?.primary_only) {
    query = query.eq('is_primary', true);
  }
  if (filter?.notify_reservations) {
    query = query.eq('notify_reservations', true);
  }
  if (filter?.notify_payments) {
    query = query.eq('notify_payments', true);
  }
  if (filter?.notify_alerts) {
    query = query.eq('notify_alerts', true);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getBossPhones] Error:', error);
  }

  if (data && data.length > 0) {
    return data;
  }

  // Fallback: read from companies.boss_phone for backward compatibility
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
      is_primary: true,
      notify_reservations: true,
      notify_payments: true,
      notify_alerts: true,
    }];
  }

  return [];
}

/**
 * Resolve which companies a boss phone number belongs to.
 * Returns company IDs and names.
 */
export async function resolveCompaniesForPhone(
  supabase: SupabaseClient,
  phone: string
): Promise<Array<{ company_id: string; company_name: string }>> {
  // Normalize phone for matching
  const normalizedPhone = phone.replace(/^whatsapp:/i, '').replace(/\s/g, '');

  // Search in the new table first
  const { data: bossPhoneEntries } = await supabase
    .from('company_boss_phones')
    .select('company_id, companies(name)')
    .or(`phone.ilike.%${normalizedPhone}%`);

  if (bossPhoneEntries && bossPhoneEntries.length > 0) {
    return bossPhoneEntries.map((entry: any) => ({
      company_id: entry.company_id,
      company_name: entry.companies?.name || 'Unknown',
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
  }));
}
