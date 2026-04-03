import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (!userData?.company_id) throw new Error('No company found');

    const companyId = userData.company_id;
    console.log(`[SEGMENT] Analyzing customers for company: ${companyId}`);

    // Get all conversations with customer data
    const { data: conversations } = await supabase
      .from('conversations')
      .select('phone, customer_name, started_at, ended_at, duration_seconds, transcript, status')
      .eq('company_id', companyId)
      .not('phone', 'is', null)
      .order('started_at', { ascending: false });

    if (!conversations || conversations.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No conversations found', segments: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get reservations
    const { data: reservations } = await supabase
      .from('reservations')
      .select('phone, created_at')
      .eq('company_id', companyId);

    // Get payments
    const { data: payments } = await supabase
      .from('payment_transactions')
      .select('customer_phone, amount, payment_status')
      .eq('company_id', companyId);

    // Group conversations by phone number
    const customerMap = new Map();

    for (const conv of conversations) {
      if (!conv.phone) continue;

      if (!customerMap.has(conv.phone)) {
        customerMap.set(conv.phone, {
          phone: conv.phone,
          name: conv.customer_name,
          conversations: [],
          reservations: [],
          payments: []
        });
      }

      customerMap.get(conv.phone).conversations.push(conv);
    }

    // Add reservations to customer map
    if (reservations) {
      for (const res of reservations) {
        if (res.phone && customerMap.has(res.phone)) {
          customerMap.get(res.phone).reservations.push(res);
        }
      }
    }

    // Add payments to customer map
    if (payments) {
      for (const pay of payments) {
        if (pay.customer_phone && customerMap.has(pay.customer_phone)) {
          customerMap.get(pay.customer_phone).payments.push(pay);
        }
      }
    }

    // Analyze and segment each customer
    const segments = [];

    for (const [phone, customer] of customerMap.entries()) {
      const analysis = analyzeCustomer(customer);
      segments.push({
        company_id: companyId,
        customer_phone: phone,
        customer_name: customer.name,
        ...analysis
      });
    }

    // Upsert segments to database
    for (const segment of segments) {
      await supabase
        .from('customer_segments')
        .upsert(segment, { onConflict: 'company_id,customer_phone' });
    }

    console.log(`[SEGMENT] Analyzed ${segments.length} customers`);

    return new Response(
      JSON.stringify({ 
        message: `Successfully segmented ${segments.length} customers`,
        segments: segments.map(s => ({
          phone: s.customer_phone,
          name: s.customer_name,
          segment: s.segment_type,
          engagement: s.engagement_level,
          intent: s.intent_category,
          conversion: s.conversion_potential
        }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SEGMENT] Error:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function analyzeCustomer(customer: any) {
  const now = new Date();
  const conversations = customer.conversations || [];
  const reservations = customer.reservations || [];
  const payments = customer.payments || [];

  // Calculate engagement metrics
  const totalConversations = conversations.length;
  const lastInteraction = conversations[0]?.started_at 
    ? new Date(conversations[0].started_at) 
    : null;
  
  const daysSinceLastInteraction = lastInteraction 
    ? Math.floor((now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  // Calculate engagement score (0-100)
  let engagementScore = 0;
  if (totalConversations >= 5) engagementScore += 30;
  else engagementScore += totalConversations * 6;
  
  if (daysSinceLastInteraction <= 7) engagementScore += 40;
  else if (daysSinceLastInteraction <= 30) engagementScore += 20;
  else if (daysSinceLastInteraction <= 90) engagementScore += 10;

  const avgDuration = conversations.reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0) / totalConversations;
  if (avgDuration > 180) engagementScore += 30;
  else if (avgDuration > 60) engagementScore += 20;
  else engagementScore += 10;

  const engagementLevel = engagementScore >= 70 ? 'high' : engagementScore >= 40 ? 'medium' : 'low';

  // Analyze intent from transcripts
  const allTranscripts = conversations.map((c: any) => c.transcript || '').join(' ').toLowerCase();
  const detectedInterests = [];
  let intentCategory = 'browsing';
  let intentScore = 30;

  // Detect buying signals
  if (allTranscripts.match(/book|reserve|reservation/gi)) {
    detectedInterests.push('reservations');
    intentScore += 20;
  }
  if (allTranscripts.match(/price|cost|pay|how much/gi)) {
    detectedInterests.push('pricing');
    intentScore += 15;
  }
  if (allTranscripts.match(/menu|food|dish|meal/gi)) {
    detectedInterests.push('menu');
    intentScore += 10;
  }
  if (allTranscripts.match(/available|when|time|open/gi)) {
    detectedInterests.push('availability');
    intentScore += 10;
  }

  // Determine intent category
  if (reservations.length > 0) {
    intentCategory = 'ready_to_buy';
    intentScore = Math.min(100, intentScore + 25);
  } else if (intentScore >= 60) {
    intentCategory = 'interested';
  } else if (totalConversations > 2) {
    intentCategory = 'interested';
  }

  // Calculate conversion potential
  const hasReservation = reservations.length > 0;
  const hasPayment = payments.length > 0;
  const totalSpend = payments
    .filter((p: any) => p.payment_status === 'completed')
    .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

  let conversionScore = intentScore * 0.4 + engagementScore * 0.3;
  if (hasReservation) conversionScore += 20;
  if (hasPayment) conversionScore += 30;

  const conversionPotential = 
    conversionScore >= 80 ? 'very_high' :
    conversionScore >= 60 ? 'high' :
    conversionScore >= 40 ? 'medium' : 'low';

  // Determine segment type
  let segmentType = 'cold_lead';
  
  if (hasPayment && totalSpend > 1000) {
    segmentType = 'vip_customer';
  } else if (hasPayment && daysSinceLastInteraction <= 30) {
    segmentType = 'active_customer';
  } else if (hasPayment && daysSinceLastInteraction > 90) {
    segmentType = 'at_risk';
  } else if (hasReservation || conversionScore >= 70) {
    segmentType = 'hot_lead';
  } else if (conversionScore >= 50 || totalConversations >= 3) {
    segmentType = 'warm_lead';
  } else if (daysSinceLastInteraction > 180) {
    segmentType = totalConversations > 0 ? 'dormant' : 'lost';
  }

  // Generate analysis notes
  const notes = generateAnalysisNotes({
    totalConversations,
    daysSinceLastInteraction,
    hasReservation,
    hasPayment,
    totalSpend,
    detectedInterests,
    engagementLevel,
    conversionPotential
  });

  return {
    engagement_score: Math.min(100, Math.round(engagementScore)),
    engagement_level: engagementLevel,
    total_conversations: totalConversations,
    avg_response_time_seconds: Math.round(avgDuration),
    last_interaction_at: lastInteraction?.toISOString(),
    
    intent_category: intentCategory,
    intent_score: Math.min(100, Math.round(intentScore)),
    detected_interests: detectedInterests,
    
    conversion_potential: conversionPotential,
    conversion_score: Math.min(100, Math.round(conversionScore)),
    has_reservation: hasReservation,
    has_payment: hasPayment,
    total_spend: totalSpend,
    
    segment_type: segmentType,
    analysis_notes: notes,
    last_analyzed_at: now.toISOString()
  };
}

function generateAnalysisNotes(data: any): string {
  const notes = [];
  
  notes.push(`Total interactions: ${data.totalConversations}`);
  
  if (data.daysSinceLastInteraction <= 7) {
    notes.push('Recently active');
  } else if (data.daysSinceLastInteraction > 90) {
    notes.push(`Inactive for ${data.daysSinceLastInteraction} days - needs re-engagement`);
  }
  
  if (data.detectedInterests.length > 0) {
    notes.push(`Interested in: ${data.detectedInterests.join(', ')}`);
  }
  
  if (data.hasPayment) {
    notes.push(`Customer with K${data.totalSpend.toFixed(2)} total spend`);
  } else if (data.hasReservation) {
    notes.push('Has made reservations but no payments yet');
  }
  
  if (data.engagementLevel === 'high' && data.conversionPotential === 'very_high') {
    notes.push('HIGH PRIORITY: Ready for upsell/cross-sell');
  } else if (data.conversionPotential === 'high' && !data.hasPayment) {
    notes.push('Strong lead - recommend immediate follow-up');
  }
  
  return notes.join('. ');
}
