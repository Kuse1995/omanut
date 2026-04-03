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

    const { bossPhone, messageBody, companyId } = await req.json();

    console.log('[BOSS-RESPONSE] Processing boss response');
    console.log('[BOSS-RESPONSE] Boss phone:', bossPhone);
    console.log('[BOSS-RESPONSE] Message:', messageBody);

    // Parse the message for commands
    const upperMessage = messageBody.trim().toUpperCase();
    
    // Extract reservation ID (first 8 chars of UUID)
    const idMatch = messageBody.match(/([A-F0-9]{8})/i);
    if (!idMatch) {
      console.log('[BOSS-RESPONSE] No reservation ID found in message');
      return new Response(
        JSON.stringify({ success: false, message: 'No reservation ID found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const shortId = idMatch[1];
    console.log('[BOSS-RESPONSE] Looking for reservation starting with:', shortId);

    // Find matching reservation
    const { data: reservations } = await supabase
      .from('reservations')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', 'pending_boss_approval')
      .ilike('id', `${shortId}%`);

    if (!reservations || reservations.length === 0) {
      console.log('[BOSS-RESPONSE] No pending reservation found');
      return new Response(
        JSON.stringify({ success: false, message: 'Reservation not found or already processed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reservation = reservations[0];
    console.log('[BOSS-RESPONSE] Found reservation:', reservation.id);

    let customerMessage = '';
    let updateData: any = {};

    // Handle APPROVE
    if (upperMessage.startsWith('APPROVE')) {
      updateData = {
        status: 'confirmed',
        boss_approved_at: new Date().toISOString(),
      };

      const dateObj = new Date(reservation.date);
      const formattedDate = dateObj.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric' 
      });

      customerMessage = `✅ Great news ${reservation.name}! Your reservation has been confirmed!\n\n` +
        `📅 Date: ${formattedDate}\n` +
        `🕐 Time: ${reservation.time}\n` +
        `👥 Guests: ${reservation.guests}\n` +
        `${reservation.area_preference ? `📍 Area: ${reservation.area_preference}\n` : ''}` +
        `\nWe look forward to seeing you! If you need to make any changes, please let us know.`;

    } 
    // Handle REJECT
    else if (upperMessage.startsWith('REJECT')) {
      const reason = messageBody.substring(messageBody.indexOf(shortId) + shortId.length).trim() || 'Unfortunately, we cannot accommodate this reservation at the requested time.';
      
      updateData = {
        status: 'rejected',
        boss_rejection_reason: reason,
      };

      customerMessage = `Thank you for your reservation request, ${reservation.name}.\n\n` +
        `Unfortunately, we cannot confirm your booking for ${reservation.time} on ${reservation.date}.\n\n` +
        `${reason}\n\n` +
        `Would you like to check availability for a different date or time?`;

    }
    // Handle SUGGEST
    else if (upperMessage.startsWith('SUGGEST')) {
      const suggestion = messageBody.substring(messageBody.indexOf(shortId) + shortId.length).trim() || 'We have alternative times available.';
      
      // Keep as pending but notify customer
      customerMessage = `Thank you for your reservation request, ${reservation.name}.\n\n` +
        `We'd like to suggest an alternative:\n${suggestion}\n\n` +
        `Would this work for you? Please let me know and I'll confirm your booking.`;

    } else {
      console.log('[BOSS-RESPONSE] Unknown command format');
      return new Response(
        JSON.stringify({ success: false, message: 'Unknown command format' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update reservation if status changed
    if (updateData.status) {
      const { error: updateError } = await supabase
        .from('reservations')
        .update(updateData)
        .eq('id', reservation.id);

      if (updateError) {
        console.error('[BOSS-RESPONSE] Update error:', updateError);
        throw new Error('Failed to update reservation');
      }

      console.log('[BOSS-RESPONSE] Reservation updated:', updateData.status);
    }

    // Send message to customer
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    
    if (!twilioSid || !twilioToken) {
      throw new Error('Twilio credentials not configured');
    }

    const customerPhone = reservation.phone.startsWith('whatsapp:') ? reservation.phone : `whatsapp:${reservation.phone}`;
    
    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: customerPhone,
          From: `whatsapp:${reservation.phone.includes('+260') ? '+13344685065' : Deno.env.get('TWILIO_WHATSAPP_NUMBER') || '+13344685065'}`,
          Body: customerMessage,
        }),
      }
    );

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      console.error('[BOSS-RESPONSE] Twilio error:', errorText);
    } else {
      console.log('[BOSS-RESPONSE] Customer notification sent');
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Response processed and customer notified' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[BOSS-RESPONSE] Error:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
