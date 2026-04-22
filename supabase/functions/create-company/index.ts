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

  // Track resources created so we can roll back on failure
  let createdAuthUserId: string | null = null;
  let createdCompanyId: string | null = null;

  try {
    // Verify the requesting user is an admin
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { data: isAdmin } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

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
      admin_email,
      admin_password,
      system_instructions,
      qa_style,
      banned_topics,
    } = await req.json();

    if (!name || !admin_email || !admin_password) {
      throw new Error('Missing required fields: name, admin_email, admin_password');
    }

    // Check for orphaned auth user (exists in auth but not in public schema)
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const orphanUser = existingUsers?.users?.find(u => u.email === admin_email);

    if (orphanUser) {
      const { count: cuCount } = await supabaseAdmin
        .from('company_users')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', orphanUser.id);

      const { count: uCount } = await supabaseAdmin
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('id', orphanUser.id);

      if ((cuCount ?? 0) === 0 && (uCount ?? 0) === 0) {
        console.log(`Deleting orphaned auth user: ${orphanUser.id} (${admin_email})`);
        await supabaseAdmin.auth.admin.deleteUser(orphanUser.id);
      } else {
        throw new Error('Email already in use by an active user');
      }
    }

    // 1. Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: admin_email,
      password: admin_password,
      email_confirm: true,
      user_metadata: { company_name: name },
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create user');
    createdAuthUserId = authData.user.id;

    const normalizedTwilio = twilio_number?.trim() || null;
    const normalizedWhatsapp = whatsapp_number?.trim() || null;

    // 2. Create company (trigger will auto-seed company_ai_overrides)
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

    // 3. Link user to company (legacy table)
    const { error: userError2 } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        email: admin_email,
        company_id: company.id,
        role: 'admin',
      });

    if (userError2) throw userError2;

    // 4. Add user to company_users as owner
    const { error: companyUserError } = await supabaseAdmin
      .from('company_users')
      .insert({
        user_id: authData.user.id,
        company_id: company.id,
        role: 'owner',
        is_default: true,
        accepted_at: new Date().toISOString(),
      });

    if (companyUserError) throw companyUserError;

    // 5. Give user client role for RLS
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: authData.user.id,
        role: 'client',
      });

    if (roleError) throw roleError;

    // 6. Update (NOT insert) company_ai_overrides — trigger already seeded the row
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

    return new Response(
      JSON.stringify({
        success: true,
        company_id: company.id,
        message: 'Company created successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('Error creating company:', error?.message || error);

    // Rollback any partial state so the next retry starts clean
    if (createdCompanyId) {
      try {
        await supabaseAdmin.from('company_ai_overrides').delete().eq('company_id', createdCompanyId);
        if (createdAuthUserId) {
          await supabaseAdmin.from('user_roles').delete().eq('user_id', createdAuthUserId);
          await supabaseAdmin.from('company_users').delete().eq('user_id', createdAuthUserId).eq('company_id', createdCompanyId);
          await supabaseAdmin.from('users').delete().eq('id', createdAuthUserId);
        }
        await supabaseAdmin.from('companies').delete().eq('id', createdCompanyId);
        console.log(`Rolled back company ${createdCompanyId}`);
      } catch (rbErr) {
        console.error('Rollback error (company):', rbErr);
      }
    }
    if (createdAuthUserId) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
        console.log(`Rolled back auth user ${createdAuthUserId}`);
      } catch (rbErr) {
        console.error('Rollback error (auth user):', rbErr);
      }
    }

    return new Response(
      JSON.stringify({ error: error?.message || 'An error occurred processing your request' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
