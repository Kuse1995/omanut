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

    // Verify the requesting user
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { company_id, email, role } = await req.json();

    // Validate required fields
    if (!company_id || !email || !role) {
      throw new Error('Missing required fields: company_id, email, role');
    }

    // Validate role
    const validRoles = ['manager', 'contributor', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new Error('Invalid role. Must be: manager, contributor, or viewer');
    }

    // Check if requesting user has permission to invite (owner or manager)
    const { data: inviterMembership, error: membershipError } = await supabaseAdmin
      .from('company_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('company_id', company_id)
      .single();

    if (membershipError || !inviterMembership) {
      throw new Error('You do not have access to this company');
    }

    if (!['owner', 'manager'].includes(inviterMembership.role)) {
      throw new Error('Only owners and managers can invite users');
    }

    // Managers cannot invite managers or owners
    if (inviterMembership.role === 'manager' && role === 'manager') {
      throw new Error('Managers cannot invite other managers');
    }

    // Check if user with this email exists
    const { data: existingUsers, error: lookupError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (lookupError) throw lookupError;

    const invitedUser = existingUsers.users.find(u => u.email === email);

    if (!invitedUser) {
      // User doesn't exist - we could create a pending invitation or create the user
      // For now, return an error asking to create account first
      throw new Error('User with this email does not have an account. They must sign up first.');
    }

    // Check if user is already a member of this company
    const { data: existingMembership } = await supabaseAdmin
      .from('company_users')
      .select('id')
      .eq('user_id', invitedUser.id)
      .eq('company_id', company_id)
      .single();

    if (existingMembership) {
      throw new Error('User is already a member of this company');
    }

    // Add user to company_users
    const { error: insertError } = await supabaseAdmin
      .from('company_users')
      .insert({
        user_id: invitedUser.id,
        company_id: company_id,
        role: role,
        invited_by: user.id,
        accepted_at: new Date().toISOString(), // Auto-accept for now
      });

    if (insertError) throw insertError;

    // Also add to legacy users table if not exists
    const { data: existingLegacyUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', invitedUser.id)
      .single();

    if (!existingLegacyUser) {
      await supabaseAdmin
        .from('users')
        .insert({
          id: invitedUser.id,
          email: email,
          company_id: company_id,
          role: role === 'owner' || role === 'manager' ? 'admin' : 'user',
        });
    }

    console.log(`User ${email} invited to company ${company_id} as ${role} by ${user.email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully added ${email} to the company as ${role}`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error('Error inviting user:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
