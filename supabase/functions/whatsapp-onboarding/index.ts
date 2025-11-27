import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface OnboardingSession {
  id: string;
  phone: string;
  status: string;
  current_step: string;
  collected_data: Record<string, any>;
  research_data?: Record<string, any>;
  created_company_id?: string;
  expires_at: string;
}

const REQUIRED_FIELDS = [
  'company_name',
  'business_type',
  'admin_email',
  'admin_password',
  'boss_phone',
  'hours',
  'services',
  'quick_reference_info'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { phone, message } = await req.json();

    console.log('Onboarding request:', { phone, message });

    // Get or create session
    let session = await getOrCreateSession(supabase, phone);
    
    // Check if session is expired
    if (new Date(session.expires_at) < new Date()) {
      session = await createNewSession(supabase, phone);
    }

    // Process message based on current step
    const aiResponse = await processOnboardingStep(supabase, session, message);

    return new Response(
      JSON.stringify({ 
        response: aiResponse,
        current_step: session.current_step 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Onboarding error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        response: "I'm having trouble processing your request. Please try again or type RESTART to begin again."
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function getOrCreateSession(supabase: any, phone: string): Promise<OnboardingSession> {
  const { data: existing, error } = await supabase
    .from('onboarding_sessions')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'in_progress')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!error && existing) {
    return existing;
  }

  return await createNewSession(supabase, phone);
}

async function createNewSession(supabase: any, phone: string): Promise<OnboardingSession> {
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .insert({
      phone,
      status: 'in_progress',
      current_step: 'welcome',
      collected_data: {}
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function processOnboardingStep(
  supabase: any, 
  session: OnboardingSession, 
  userMessage: string
): Promise<string> {
  
  const trimmedMessage = userMessage.trim();
  
  // Handle special commands
  if (trimmedMessage.toUpperCase() === 'RESTART') {
    await supabase
      .from('onboarding_sessions')
      .update({ 
        current_step: 'welcome',
        collected_data: {},
        research_data: null
      })
      .eq('id', session.id);
    
    return getWelcomeMessage();
  }

  if (trimmedMessage.toUpperCase() === 'CANCEL') {
    await supabase
      .from('onboarding_sessions')
      .update({ status: 'cancelled' })
      .eq('id', session.id);
    
    return "Onboarding cancelled. Text ONBOARD anytime to start again! 👋";
  }

  // Process based on current step
  switch (session.current_step) {
    case 'welcome':
      return await handleWelcome(supabase, session, trimmedMessage);
    
    case 'company_name':
      return await handleCompanyName(supabase, session, trimmedMessage);
    
    case 'confirm_research':
      return await handleConfirmResearch(supabase, session, trimmedMessage);
    
    case 'admin_email':
      return await handleAdminEmail(supabase, session, trimmedMessage);
    
    case 'admin_password':
      return await handleAdminPassword(supabase, session, trimmedMessage);
    
    case 'boss_phone':
      return await handleBossPhone(supabase, session, trimmedMessage);
    
    case 'final_confirmation':
      return await handleFinalConfirmation(supabase, session, trimmedMessage);
    
    default:
      return "Something went wrong. Type RESTART to begin again.";
  }
}

function getWelcomeMessage(): string {
  return `🎉 Welcome to company onboarding!

I'll help you set up your AI-powered customer service system in just a few minutes.

Let's start with your company name. What's your business called?

(Type CANCEL anytime to stop)`;
}

async function handleWelcome(supabase: any, session: OnboardingSession, message: string): Promise<string> {
  await supabase
    .from('onboarding_sessions')
    .update({ current_step: 'company_name' })
    .eq('id', session.id);
  
  return await handleCompanyName(supabase, session, message);
}

async function handleCompanyName(supabase: any, session: OnboardingSession, companyName: string): Promise<string> {
  console.log('Researching company:', companyName);
  
  // Call research-company function
  try {
    const researchResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/research-company`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          company_name: companyName 
        }),
      }
    );

    const researchResult = await researchResponse.json();
    console.log('Research result:', researchResult);

    if (researchResult.data) {
      // Store research data
      const updatedData = { 
        ...session.collected_data, 
        company_name: companyName 
      };
      
      await supabase
        .from('onboarding_sessions')
        .update({ 
          collected_data: updatedData,
          research_data: researchResult.data,
          current_step: 'confirm_research'
        })
        .eq('id', session.id);

      const confidence = researchResult.data.confidence_score || 0;
      
      return `✅ Found information about "${companyName}"!

📊 Confidence: ${confidence}%
${researchResult.data.research_summary || ''}

I can auto-fill these details:
• Business type: ${researchResult.data.business_type || 'N/A'}
• Hours: ${researchResult.data.hours || 'N/A'}
• Services: ${researchResult.data.services?.substring(0, 50) || 'N/A'}...

Would you like to use this information? (YES/NO)`;
    }
  } catch (error) {
    console.error('Research failed:', error);
  }

  // If research fails, continue without it
  const updatedData = { 
    ...session.collected_data, 
    company_name: companyName 
  };
  
  await supabase
    .from('onboarding_sessions')
    .update({ 
      collected_data: updatedData,
      current_step: 'admin_email'
    })
    .eq('id', session.id);

  return `Great! Setting up "${companyName}" 🎯

Now I need some admin details. What email should we use for the admin account?`;
}

async function handleConfirmResearch(supabase: any, session: OnboardingSession, response: string): Promise<string> {
  const answer = response.trim().toUpperCase();
  
  if (answer === 'YES' || answer === 'Y') {
    // Apply research data
    const researchData = session.research_data || {};
    const updatedData = {
      ...session.collected_data,
      business_type: researchData.business_type || 'restaurant',
      hours: researchData.hours || 'Mon-Sun 10:00-22:00',
      services: researchData.services || 'Various services',
      voice_style: researchData.voice_style || 'Professional and friendly',
      quick_reference_info: researchData.quick_reference_info || '',
      system_instructions: researchData.system_instructions || '',
      qa_style: researchData.qa_style || '',
      banned_topics: researchData.banned_topics || ''
    };

    await supabase
      .from('onboarding_sessions')
      .update({ 
        collected_data: updatedData,
        current_step: 'admin_email'
      })
      .eq('id', session.id);

    return `Perfect! I've saved those details ✅

Now, what email should we use for the admin account?`;
  } else {
    // Skip research, continue manually
    await supabase
      .from('onboarding_sessions')
      .update({ current_step: 'admin_email' })
      .eq('id', session.id);

    return `No problem! We'll fill in the details manually.

What email should we use for the admin account?`;
  }
}

async function handleAdminEmail(supabase: any, session: OnboardingSession, email: string): Promise<string> {
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return `That doesn't look like a valid email address. Please try again:`;
  }

  const updatedData = { ...session.collected_data, admin_email: email };
  
  await supabase
    .from('onboarding_sessions')
    .update({ 
      collected_data: updatedData,
      current_step: 'admin_password'
    })
    .eq('id', session.id);

  return `Great! Email saved: ${email} ✅

Now create a secure password (minimum 8 characters, must include a number):`;
}

async function handleAdminPassword(supabase: any, session: OnboardingSession, password: string): Promise<string> {
  // Validate password strength
  if (password.length < 8) {
    return `Password must be at least 8 characters. Please try again:`;
  }
  
  if (!/\d/.test(password)) {
    return `Password must contain at least one number. Please try again:`;
  }

  const updatedData = { ...session.collected_data, admin_password: password };
  
  await supabase
    .from('onboarding_sessions')
    .update({ 
      collected_data: updatedData,
      current_step: 'boss_phone'
    })
    .eq('id', session.id);

  return `Password saved securely! 🔒

What's the boss/owner phone number for important notifications? (or type SKIP to use ${session.phone})`;
}

async function handleBossPhone(supabase: any, session: OnboardingSession, phone: string): Promise<string> {
  let bossPhone = phone.trim();
  
  if (bossPhone.toUpperCase() === 'SKIP') {
    bossPhone = session.phone;
  }

  const updatedData: Record<string, any> = { ...session.collected_data, boss_phone: bossPhone };
  
  await supabase
    .from('onboarding_sessions')
    .update({ 
      collected_data: updatedData,
      current_step: 'final_confirmation'
    })
    .eq('id', session.id);

  // Show summary
  return `Perfect! Let me confirm everything:

🏢 Company: ${updatedData.company_name}
📧 Admin Email: ${updatedData.admin_email}
📱 Boss Phone: ${updatedData.boss_phone}
⏰ Hours: ${updatedData.hours || 'Not set'}
🛎️ Services: ${updatedData.services?.substring(0, 50) || 'Not set'}...

Everything look good? Reply YES to create your company!`;
}

async function handleFinalConfirmation(supabase: any, session: OnboardingSession, response: string): Promise<string> {
  const answer = response.trim().toUpperCase();
  
  if (answer !== 'YES' && answer !== 'Y') {
    return `No problem! Type RESTART to begin again, or CANCEL to stop.`;
  }

  // Create the company
  console.log('Creating company with data:', session.collected_data);
  
  try {
    const createResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/create-company`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyData: {
            name: session.collected_data.company_name,
            business_type: session.collected_data.business_type || 'restaurant',
            hours: session.collected_data.hours || 'Mon-Sun 10:00-22:00',
            services: session.collected_data.services || 'Various services',
            voice_style: session.collected_data.voice_style || 'Professional and friendly',
            boss_phone: session.collected_data.boss_phone,
            quick_reference_info: session.collected_data.quick_reference_info || '',
            whatsapp_number: session.phone
          },
          adminCredentials: {
            email: session.collected_data.admin_email,
            password: session.collected_data.admin_password
          },
          aiOverrides: session.collected_data.system_instructions ? {
            system_instructions: session.collected_data.system_instructions,
            qa_style: session.collected_data.qa_style || '',
            banned_topics: session.collected_data.banned_topics || ''
          } : undefined
        }),
      }
    );

    const createResult = await createResponse.json();
    console.log('Company creation result:', createResult);

    if (!createResponse.ok) {
      throw new Error(createResult.error || 'Failed to create company');
    }

    // Mark session as completed
    await supabase
      .from('onboarding_sessions')
      .update({ 
        status: 'completed',
        created_company_id: createResult.companyId
      })
      .eq('id', session.id);

    return `🎉 Success! Your company "${session.collected_data.company_name}" is now set up!

📧 Login at: https://yourapp.com/login
Email: ${session.collected_data.admin_email}

Your AI assistant is ready to handle customer inquiries via WhatsApp!

Welcome aboard! 🚀`;

  } catch (error: any) {
    console.error('Company creation failed:', error);
    return `❌ Oops! Something went wrong creating your company: ${error.message}

Please contact support or type RESTART to try again.`;
  }
}
