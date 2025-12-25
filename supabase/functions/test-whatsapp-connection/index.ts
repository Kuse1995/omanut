import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestConnectionRequest {
  companyId: string;
  metaPhoneNumberId?: string;
  metaBusinessAccountId?: string;
}

interface TestResult {
  success: boolean;
  phoneNumberValid: boolean;
  businessAccountValid: boolean;
  phoneNumberName?: string;
  businessAccountName?: string;
  error?: string;
  details?: {
    phoneNumberError?: string;
    businessAccountError?: string;
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { companyId, metaPhoneNumberId, metaBusinessAccountId } = await req.json() as TestConnectionRequest;

    console.log('Testing WhatsApp connection for company:', companyId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get company data if IDs not provided directly
    let phoneNumberId = metaPhoneNumberId;
    let businessAccountId = metaBusinessAccountId;

    if (!phoneNumberId || !businessAccountId) {
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('meta_phone_number_id, meta_business_account_id, name')
        .eq('id', companyId)
        .single();

      if (companyError) {
        console.error('Error fetching company:', companyError);
        return new Response(JSON.stringify({
          success: false,
          phoneNumberValid: false,
          businessAccountValid: false,
          error: 'Failed to fetch company details'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      phoneNumberId = metaPhoneNumberId || company?.meta_phone_number_id;
      businessAccountId = metaBusinessAccountId || company?.meta_business_account_id;
    }

    const accessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN');
    
    if (!accessToken) {
      return new Response(JSON.stringify({
        success: false,
        phoneNumberValid: false,
        businessAccountValid: false,
        error: 'META_WHATSAPP_ACCESS_TOKEN not configured in secrets'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result: TestResult = {
      success: false,
      phoneNumberValid: false,
      businessAccountValid: false,
      details: {}
    };

    // Test Phone Number ID
    if (phoneNumberId) {
      try {
        console.log('Testing phone number ID:', phoneNumberId);
        const phoneResponse = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );

        const phoneData = await phoneResponse.json();
        console.log('Phone number response:', JSON.stringify(phoneData));

        if (phoneResponse.ok && phoneData.id) {
          result.phoneNumberValid = true;
          result.phoneNumberName = phoneData.display_phone_number || phoneData.verified_name || 'Valid';
        } else {
          result.details!.phoneNumberError = phoneData.error?.message || 'Invalid phone number ID';
        }
      } catch (err) {
        console.error('Error testing phone number:', err);
        result.details!.phoneNumberError = 'Failed to connect to Meta API';
      }
    } else {
      result.details!.phoneNumberError = 'Meta Phone Number ID not configured';
    }

    // Test Business Account ID
    if (businessAccountId) {
      try {
        console.log('Testing business account ID:', businessAccountId);
        const businessResponse = await fetch(
          `https://graph.facebook.com/v21.0/${businessAccountId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );

        const businessData = await businessResponse.json();
        console.log('Business account response:', JSON.stringify(businessData));

        if (businessResponse.ok && businessData.id) {
          result.businessAccountValid = true;
          result.businessAccountName = businessData.name || 'Valid';
        } else {
          result.details!.businessAccountError = businessData.error?.message || 'Invalid business account ID';
        }
      } catch (err) {
        console.error('Error testing business account:', err);
        result.details!.businessAccountError = 'Failed to connect to Meta API';
      }
    } else {
      result.details!.businessAccountError = 'Meta Business Account ID not configured';
    }

    // Overall success
    result.success = result.phoneNumberValid && result.businessAccountValid;

    if (!result.success) {
      const errors = [];
      if (result.details!.phoneNumberError) errors.push(result.details!.phoneNumberError);
      if (result.details!.businessAccountError) errors.push(result.details!.businessAccountError);
      result.error = errors.join('; ');
    }

    console.log('Test result:', JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in test-whatsapp-connection:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({
      success: false,
      phoneNumberValid: false,
      businessAccountValid: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
