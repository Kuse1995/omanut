import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getBossPhones } from "../_shared/boss-phones.ts";
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

    const { reservation_id } = await req.json();

    console.log('[BOSS-REQUEST] Processing reservation request:', reservation_id);

    // Fetch reservation details
    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      .select('*, company_id')
      .eq('id', reservation_id)
      .single();

    if (resError || !reservation) {
      throw new Error('Reservation not found');
    }

    // Fetch company details
    const { data: company, error: compError } = await supabase
      .from('companies')
      .select('name, test_mode, boss_phone')
      .eq('id', reservation.company_id)
      .single();

    // Get boss phones with reservation notification preference
    const bossPhones = await getBossPhones(supabase as any, reservation.company_id, { notify_reservations: true });

    if (compError || !company || bossPhones.length === 0) {
      console.log('[BOSS-REQUEST] No boss phones configured for reservations');
      return new Response(
        JSON.stringify({ success: false, message: 'No boss phone configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if company is in test mode (before building message for efficiency)
    if (company.test_mode) {
      console.log('═══════════════════════════════════════════════');
      console.log('🧪 TEST MODE - BOSS NOTIFICATION (NOT SENT)');
      console.log('═══════════════════════════════════════════════');
      console.log('Boss Phones:', bossPhones.map(p => p.phone).join(', '));
      console.log('Reservation ID:', reservation_id);
      console.log('Customer:', reservation.name);
      console.log('Date/Time:', reservation.date, reservation.time);
      console.log('Guests:', reservation.guests);
      console.log('Email:', reservation.email);
      console.log('Occasion:', reservation.occasion || 'None');
      console.log('Area Preference:', reservation.area_preference || 'None');
      console.log('═══════════════════════════════════════════════');
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          test_mode: true,
          message: 'Test mode: Notification logged but not sent',
          details: {
            boss_phone: company.boss_phone,
            company_name: company.name,
            reservation: {
              id: reservation_id,
              customer: reservation.name,
              date: reservation.date,
              time: reservation.time,
              guests: reservation.guests,
              email: reservation.email
            }
          }
        }),
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
✅ "APPROVE ${reservation_id.slice(0, 8)}" to confirm
❌ "REJECT ${reservation_id.slice(0, 8)} [reason]" to decline
💬 "SUGGEST ${reservation_id.slice(0, 8)} [alternative]" to propose different time`;

    console.log('[BOSS-REQUEST] Sending notification to boss phones:', bossPhones.map(p => p.phone));
    console.log('[BOSS-REQUEST] Message:', message);

    // Send via Twilio to all boss phones
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    
    if (!twilioSid || !twilioToken) {
      throw new Error('Twilio credentials not configured');
    }

    for (const bossPhone of bossPhones) {
      const cleanPhone = bossPhone.phone.replace(/^whatsapp:/, '').replace(/^\+?/, '+');
      
      const twilioResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: `whatsapp:${cleanPhone}`,
            From: `whatsapp:${cleanPhone.includes('+260') ? '+13344685065' : Deno.env.get('TWILIO_WHATSAPP_NUMBER') || '+13344685065'}`,
            Body: message,
          }),
        }
      );

      if (!twilioResponse.ok) {
        const errorText = await twilioResponse.text();
        console.error(`[BOSS-REQUEST] Twilio error for ${bossPhone.phone}:`, errorText);
      } else {
        console.log(`[BOSS-REQUEST] Notification sent to ${bossPhone.label || bossPhone.phone}`);
      }
    }

    // Per-recipient errors are logged in the loop above.

    console.log('[BOSS-REQUEST] Notification sent successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Boss notification sent' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[BOSS-REQUEST] Error:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
