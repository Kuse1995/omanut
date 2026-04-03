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

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verify the requesting user is an admin
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user has admin role
    const { data: isAdmin } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    // Parse request body
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

    // Validate required fields
    if (!name || !admin_email || !admin_password) {
      throw new Error('Missing required fields: name, admin_email, admin_password');
    }

    // Check for orphaned auth user (exists in auth but not in public schema)
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const orphanUser = existingUsers?.users?.find(u => u.email === admin_email);
    
    if (orphanUser) {
      // Check if this user has any active company memberships
      const { count: cuCount } = await supabaseAdmin
        .from('company_users')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', orphanUser.id);
      
      const { count: uCount } = await supabaseAdmin
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('id', orphanUser.id);
      
      if ((cuCount ?? 0) === 0 && (uCount ?? 0) === 0) {
        // Orphan — delete before re-creating
        console.log(`Deleting orphaned auth user: ${orphanUser.id} (${admin_email})`);
        await supabaseAdmin.auth.admin.deleteUser(orphanUser.id);
      } else {
        throw new Error('Email already in use by an active user');
      }
    }

    // Create auth user using admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: admin_email,
      password: admin_password,
      email_confirm: true,
      user_metadata: {
        company_name: name,
      }
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create user');

    // Normalize empty strings to NULL to avoid unique constraint violations
    const normalizedTwilio = twilio_number?.trim() || null;
    const normalizedWhatsapp = whatsapp_number?.trim() || null;

    // Create company
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

    // Link user to company (legacy table)
    const { error: userError2 } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        email: admin_email,
        company_id: company.id,
        role: 'admin',
      });

    if (userError2) throw userError2;

    // Add user to company_users as owner (new multi-tenant table)
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

    // Give user client role for RLS
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: authData.user.id,
        role: 'client',
      });

    if (roleError) throw roleError;

    // Create AI overrides if provided
    if (system_instructions || qa_style || banned_topics) {
      const { error: aiError } = await supabaseAdmin
        .from('company_ai_overrides')
        .insert({
          company_id: company.id,
          system_instructions: system_instructions || '',
          qa_style: qa_style || '',
          banned_topics: banned_topics || '',
        });

      if (aiError) throw aiError;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        company_id: company.id,
        message: 'Company created successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error('Error creating company:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
