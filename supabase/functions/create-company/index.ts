import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let createdCompanyId: string | null = null;

  try {
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error('Unauthorized');

    const { data: isAdmin } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();
    if (!isAdmin) throw new Error('Unauthorized: Admin access required');

    const {
      name,
      business_type,
      voice_style,
      hours,
      services,
      branches,
      currency_prefix,
      service_locations,
      twilio_number,
      whatsapp_number,
      whatsapp_voice_enabled,
      test_mode,
      credit_balance,
      quick_reference_info,
      system_instructions,
      qa_style,
      banned_topics,
    } = await req.json();

    if (!name) throw new Error('Missing required field: name');

    const normalizedTwilio = twilio_number?.trim() || null;
    const normalizedWhatsapp = whatsapp_number?.trim() || null;

    // 1. Create company (triggers auto-seed company_ai_overrides AND company_claim_codes)
    const { data: company, error: companyError } = await supabaseAdmin
      .from('companies')
      .insert({
        name,
        business_type,
        voice_style,
        hours,
        services,
        branches,
        currency_prefix,
        service_locations,
        twilio_number: normalizedTwilio,
        whatsapp_number: normalizedWhatsapp,
        whatsapp_voice_enabled,
        test_mode: test_mode ?? true,
        credit_balance,
        quick_reference_info,
      })
      .select()
      .single();

    if (companyError) throw companyError;
    createdCompanyId = company.id;

    // 2. Update AI overrides if provided
    if (system_instructions || qa_style || banned_topics) {
      const { error: aiError } = await supabaseAdmin
        .from('company_ai_overrides')
        .update({
          system_instructions: system_instructions || '',
          qa_style: qa_style || '',
          banned_topics: banned_topics || '',
        })
        .eq('company_id', company.id);
      if (aiError) throw aiError;
    }

    // 3. Fetch the auto-generated claim code so admin can copy it
    const { data: claim } = await supabaseAdmin
      .from('company_claim_codes')
      .select('code')
      .eq('company_id', company.id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        company_id: company.id,
        claim_code: claim?.code ?? null,
        message: 'Company created. Share the claim code with the client so they can sign up at /signup and claim it.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('Error creating company:', error?.message || error);

    if (createdCompanyId) {
      try {
        await supabaseAdmin.from('company_ai_overrides').delete().eq('company_id', createdCompanyId);
        await supabaseAdmin.from('company_claim_codes').delete().eq('company_id', createdCompanyId);
        await supabaseAdmin.from('companies').delete().eq('id', createdCompanyId);
      } catch (rbErr) {
        console.error('Rollback error:', rbErr);
      }
    }

    return new Response(
      JSON.stringify({ error: error?.message || 'An error occurred processing your request' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
