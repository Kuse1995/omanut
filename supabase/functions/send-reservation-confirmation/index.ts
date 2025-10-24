import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

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
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, email, date, time, guests, restaurantName }: ReservationEmailRequest = await req.json();

    const formattedDate = new Date(date).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const emailResponse = await resend.emails.send({
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
    });

    console.log("Confirmation email sent:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
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