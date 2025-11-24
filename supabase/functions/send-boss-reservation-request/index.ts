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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { reservationId } = await req.json();

    console.log('[BOSS-REQUEST] Processing reservation request:', reservationId);

    // Fetch reservation details
    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      .select('*, company_id')
      .eq('id', reservationId)
      .single();

    if (resError || !reservation) {
      throw new Error('Reservation not found');
    }

    // Fetch company details
    const { data: company, error: compError } = await supabase
      .from('companies')
      .select('boss_phone, name')
      .eq('id', reservation.company_id)
      .single();

    if (compError || !company?.boss_phone) {
      console.log('[BOSS-REQUEST] No boss phone configured');
      return new Response(
        JSON.stringify({ success: false, message: 'No boss phone configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get other reservations for the same day for context
    const { data: dayReservations } = await supabase
      .from('reservations')
      .select('name, time, guests, occasion, area_preference, status')
      .eq('company_id', reservation.company_id)
      .eq('date', reservation.date)
      .in('status', ['pending_boss_approval', 'confirmed'])
      .order('time', { ascending: true });

    // Build day schedule context
    let scheduleContext = '';
    if (dayReservations && dayReservations.length > 0) {
      scheduleContext = '\n\n📊 SCHEDULE FOR THIS DAY:\n';
      dayReservations.forEach(res => {
        const isNew = res.name === reservation.name && res.time === reservation.time;
        const marker = isNew ? ' ← NEW REQUEST' : '';
        const statusIcon = res.status === 'confirmed' ? '✅' : '🕐';
        scheduleContext += `${statusIcon} ${res.time} - ${res.name} (${res.guests} guests)${res.occasion ? ' - ' + res.occasion : ''}${marker}\n`;
      });

      // Add insights
      const confirmedCount = dayReservations.filter(r => r.status === 'confirmed').length;
      const pendingCount = dayReservations.filter(r => r.status === 'pending_boss_approval').length;
      scheduleContext += `\n💡 INSIGHTS:\n`;
      scheduleContext += `• Total bookings: ${dayReservations.length} (${confirmedCount} confirmed, ${pendingCount} pending)\n`;
      scheduleContext += `• Total guests scheduled: ${dayReservations.reduce((sum, r) => sum + r.guests, 0)}\n`;
    }

    // Format date nicely
    const dateObj = new Date(reservation.date);
    const formattedDate = dateObj.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    // Build notification message
    const message = `📅 Reservation Request for ${formattedDate}

🔔 NEW REQUEST:
Name: ${reservation.name}
Phone: ${reservation.phone}
${reservation.email ? `Email: ${reservation.email}\n` : ''}Time: ${reservation.time}
Guests: ${reservation.guests}
${reservation.occasion ? `Occasion: ${reservation.occasion}\n` : ''}${reservation.area_preference ? `Area: ${reservation.area_preference}\n` : ''}${reservation.branch ? `Branch: ${reservation.branch}\n` : ''}${scheduleContext}

Reply with:
✅ "APPROVE ${reservationId.slice(0, 8)}" to confirm
❌ "REJECT ${reservationId.slice(0, 8)} [reason]" to decline
💬 "SUGGEST ${reservationId.slice(0, 8)} [alternative]" to propose different time`;

    console.log('[BOSS-REQUEST] Sending notification to boss:', company.boss_phone);
    console.log('[BOSS-REQUEST] Message:', message);

    // Send via Twilio
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    
    if (!twilioSid || !twilioToken) {
      throw new Error('Twilio credentials not configured');
    }

    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`,
          From: `whatsapp:${company.boss_phone.includes('+260') ? '+13344685065' : Deno.env.get('TWILIO_WHATSAPP_NUMBER') || '+13344685065'}`,
          Body: message,
        }),
      }
    );

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      console.error('[BOSS-REQUEST] Twilio error:', errorText);
      throw new Error('Failed to send notification');
    }

    console.log('[BOSS-REQUEST] Notification sent successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Boss notification sent' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[BOSS-REQUEST] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
