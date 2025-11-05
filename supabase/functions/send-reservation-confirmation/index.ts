import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReservationEmailRequest {
  name: string;
  email: string;
  date: string;
  time: string;
  guests: number;
  restaurantName: string;
  reservationId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, email, date, time, guests, restaurantName, reservationId }: ReservationEmailRequest = await req.json();

    const formattedDate = new Date(date).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Send email via Resend API
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'hi@build-loop.ai',
        to: [email],
        subject: `Your Reservation at ${restaurantName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #84CC16;">Reservation Confirmed</h2>
            <p>Dear ${name},</p>
            <p>Your reservation at <strong>${restaurantName}</strong> has been confirmed!</p>
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Date:</strong> ${formattedDate}</p>
              <p style="margin: 5px 0;"><strong>Time:</strong> ${time}</p>
              <p style="margin: 5px 0;"><strong>Guests:</strong> ${guests} ${guests === 1 ? 'person' : 'people'}</p>
            </div>

            <p>We're looking forward to welcoming you! If you need to make any changes or have special requests, please don't hesitate to call us.</p>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              The ${restaurantName} Team
            </p>
          </div>
        `,
      }),
    });

    const result = await emailResponse.json();
    
    if (!emailResponse.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(result)}`);
    }

    console.log("Confirmation email sent:", result);

    // Notify boss if reservation ID is provided
    if (reservationId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const { data: reservation } = await supabase
        .from('reservations')
        .select('*, companies(id, boss_phone)')
        .eq('id', reservationId)
        .single();

      if (reservation?.companies?.boss_phone) {
        supabase.functions.invoke('send-boss-notification', {
          body: {
            companyId: reservation.companies.id,
            notificationType: 'new_reservation',
            data: {
              name: reservation.name,
              phone: reservation.phone,
              guests: reservation.guests,
              date: reservation.date,
              time: reservation.time,
              area_preference: reservation.area_preference,
              occasion: reservation.occasion
            }
          }
        }).catch(err => console.error('Boss notification failed:', err));
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-reservation-confirmation function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);