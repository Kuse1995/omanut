import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  company_id: string;
  notification_type: 'reservation' | 'important_client' | 'demo_booking';
  data: any;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { company_id, notification_type, data }: NotificationRequest = await req.json();

    // Fetch company details and admin emails
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('name')
      .eq('id', company_id)
      .single();

    if (companyError || !company) {
      console.error('Error fetching company:', companyError);
      throw new Error('Company not found');
    }

    // Fetch admin users for this company
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email')
      .eq('company_id', company_id);

    if (usersError || !users || users.length === 0) {
      console.error('No admin users found for company:', company_id);
      return new Response(
        JSON.stringify({ success: false, message: 'No admin emails found' }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const adminEmails = users.map(u => u.email);
    console.log('Sending notification to:', adminEmails);

    let subject = '';
    let htmlContent = '';

    if (notification_type === 'reservation') {
      subject = `New Reservation - ${data.name}`;
      htmlContent = `
        <h1>New Reservation Alert</h1>
        <p>A new reservation has been made for ${company.name}:</p>
        <ul>
          <li><strong>Name:</strong> ${data.name}</li>
          <li><strong>Phone:</strong> ${data.phone}</li>
          <li><strong>Email:</strong> ${data.email || 'Not provided'}</li>
          <li><strong>Date:</strong> ${data.date}</li>
          <li><strong>Time:</strong> ${data.time}</li>
          <li><strong>Guests:</strong> ${data.guests}</li>
          <li><strong>Branch:</strong> ${data.branch}</li>
          <li><strong>Area:</strong> ${data.area_preference || 'Not specified'}</li>
          <li><strong>Occasion:</strong> ${data.occasion || 'Not specified'}</li>
        </ul>
        <p>Please ensure everything is prepared for their arrival.</p>
      `;
    } else if (notification_type === 'important_client') {
      subject = `Important Client Alert - ${data.customer_name || 'Unnamed'}`;
      htmlContent = `
        <h1>Important Client Detected</h1>
        <p>A client with high importance has been identified:</p>
        <ul>
          <li><strong>Name:</strong> ${data.customer_name || 'Not provided'}</li>
          <li><strong>Phone:</strong> ${data.customer_phone || 'Not provided'}</li>
          <li><strong>Importance:</strong> ${data.importance}</li>
          <li><strong>Type:</strong> ${data.info_type}</li>
          <li><strong>Information:</strong> ${data.information}</li>
        </ul>
        <p>This client may require special attention or follow-up.</p>
      `;
    } else if (notification_type === 'demo_booking') {
      subject = `Demo/Meeting Request - ${data.customer_name || 'Unnamed'}`;
      htmlContent = `
        <h1>Demo/Meeting Booking</h1>
        <p>A demo or meeting has been requested:</p>
        <ul>
          <li><strong>Name:</strong> ${data.customer_name || 'Not provided'}</li>
          <li><strong>Phone:</strong> ${data.customer_phone || 'Not provided'}</li>
          <li><strong>Type:</strong> ${data.action_type}</li>
          <li><strong>Description:</strong> ${data.description}</li>
          <li><strong>Priority:</strong> ${data.priority || 'medium'}</li>
          ${data.due_date ? `<li><strong>Due Date:</strong> ${data.due_date}</li>` : ''}
          ${data.notes ? `<li><strong>Notes:</strong> ${data.notes}</li>` : ''}
        </ul>
        <p>Please follow up with this client as soon as possible.</p>
      `;
    }

    // Send email to all admin users via Resend API
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Omanut Notifications <onboarding@resend.dev>',
        to: adminEmails,
        subject: subject,
        html: htmlContent,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error('Resend API error:', errorText);
      throw new Error(`Failed to send email: ${errorText}`);
    }

    const result = await emailResponse.json();
    console.log("Notification email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, sent_to: adminEmails }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-company-notification:", error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
