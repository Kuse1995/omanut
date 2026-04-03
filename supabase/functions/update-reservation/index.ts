import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reservationId, action, updates, notifyCustomer } = await req.json();

    if (!reservationId || !action) {
      throw new Error('reservationId and action are required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get current reservation
    const { data: reservation, error: fetchError } = await supabase
      .from('reservations')
      .select('*, companies(*)')
      .eq('id', reservationId)
      .single();

    if (fetchError || !reservation) {
      throw new Error('Reservation not found');
    }

    const company = reservation.companies;
    console.log(`[RESERVATION] ${action} for reservation ${reservationId}`);

    if (action === 'update') {
      // Update reservation in database
      const { error: updateError } = await supabase
        .from('reservations')
        .update({
          ...updates,
          calendar_sync_status: 'pending',
        })
        .eq('id', reservationId);

      if (updateError) throw updateError;

      // Update calendar event if synced
      if (reservation.google_calendar_event_id && company.calendar_sync_enabled) {
        try {
          const { error: calError } = await supabase.functions.invoke('google-calendar', {
            body: {
              action: 'update_event',
              companyId: company.id,
              reservationId: reservationId,
              eventId: reservation.google_calendar_event_id,
              title: `Reservation: ${updates.name || reservation.name} - ${updates.guests || reservation.guests} guests`,
              description: `Phone: ${updates.phone || reservation.phone}\nEmail: ${updates.email || reservation.email || 'N/A'}\nArea: ${updates.area_preference || reservation.area_preference}\nOccasion: ${updates.occasion || reservation.occasion || 'N/A'}`,
            }
          });

          if (calError) {
            console.error('[RESERVATION] Calendar update failed:', calError);
          } else {
            console.log('[RESERVATION] Calendar event updated successfully');
          }
        } catch (error) {
          console.error('[RESERVATION] Calendar update error:', error);
        }
      }

      // Send customer notification
      if (notifyCustomer !== false && company.whatsapp_number) {
        await sendUpdateNotification(supabase, company, reservation, updates);
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Reservation updated' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'cancel') {
      // Update reservation status
      const { error: cancelError } = await supabase
        .from('reservations')
        .update({
          status: 'cancelled',
          calendar_sync_status: 'cancelled',
        })
        .eq('id', reservationId);

      if (cancelError) throw cancelError;

      // Delete calendar event if synced
      if (reservation.google_calendar_event_id && company.calendar_sync_enabled) {
        try {
          const { error: calError } = await supabase.functions.invoke('google-calendar', {
            body: {
              action: 'delete_event',
              companyId: company.id,
              reservationId: reservationId,
              eventId: reservation.google_calendar_event_id,
              sendNotifications: true,
            }
          });

          if (calError) {
            console.error('[RESERVATION] Calendar delete failed:', calError);
          } else {
            console.log('[RESERVATION] Calendar event deleted successfully');
          }
        } catch (error) {
          console.error('[RESERVATION] Calendar delete error:', error);
        }
      }

      // Send customer notification
      if (notifyCustomer !== false && company.whatsapp_number) {
        await sendCancellationNotification(supabase, company, reservation);
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Reservation cancelled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    console.error('[RESERVATION] Error:', error);
    const errorMessage = 'An error occurred processing your request';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function sendUpdateNotification(supabase: any, company: any, reservation: any, updates: any) {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.log('[RESERVATION] Twilio credentials not configured');
    return;
  }

  const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
    ? company.whatsapp_number 
    : `whatsapp:${company.whatsapp_number}`;

  const customerPhone = reservation.phone.startsWith('+') ? reservation.phone : `+${reservation.phone}`;
  
  let message = `📝 *Reservation Updated*\n\n`;
  message += `Your reservation at ${company.name} has been updated:\n\n`;
  
  if (updates.date) {
    message += `📅 New Date: ${new Date(updates.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
  }
  if (updates.time) {
    message += `⏰ New Time: ${updates.time}\n`;
  }
  if (updates.guests) {
    message += `👥 Guests: ${updates.guests}\n`;
  }
  if (updates.area_preference) {
    message += `📍 Area: ${updates.area_preference}\n`;
  }
  
  message += `\nIf you have any questions, please contact us.`;

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const formData = new URLSearchParams();
    formData.append('From', fromNumber);
    formData.append('To', `whatsapp:${customerPhone}`);
    formData.append('Body', message);

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (response.ok) {
      console.log('[RESERVATION] Update notification sent successfully');
    } else {
      const error = await response.text();
      console.error('[RESERVATION] Failed to send update notification:', error);
    }
  } catch (error) {
    console.error('[RESERVATION] Error sending update notification:', error);
  }
}

async function sendCancellationNotification(supabase: any, company: any, reservation: any) {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.log('[RESERVATION] Twilio credentials not configured');
    return;
  }

  const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
    ? company.whatsapp_number 
    : `whatsapp:${company.whatsapp_number}`;

  const customerPhone = reservation.phone.startsWith('+') ? reservation.phone : `+${reservation.phone}`;
  
  const message = `❌ *Reservation Cancelled*\n\n` +
    `Your reservation at ${company.name} has been cancelled:\n\n` +
    `📅 Date: ${new Date(reservation.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n` +
    `⏰ Time: ${reservation.time}\n` +
    `👥 Guests: ${reservation.guests}\n\n` +
    `We apologize for any inconvenience. Feel free to make a new reservation anytime!`;

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const formData = new URLSearchParams();
    formData.append('From', fromNumber);
    formData.append('To', `whatsapp:${customerPhone}`);
    formData.append('Body', message);

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (response.ok) {
      console.log('[RESERVATION] Cancellation notification sent successfully');
    } else {
      const error = await response.text();
      console.error('[RESERVATION] Failed to send cancellation notification:', error);
    }
  } catch (error) {
    console.error('[RESERVATION] Error sending cancellation notification:', error);
  }
}
