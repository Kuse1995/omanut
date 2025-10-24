import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LoginNotificationRequest {
  email: string;
  timestamp: string;
  ipAddress?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, timestamp, ipAddress }: LoginNotificationRequest = await req.json();

    // Send email via Resend API
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Omanut Assistant <hi@omanutassistant.com>',
        to: [email],
        subject: "Admin Portal Login Confirmation",
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(90deg, #0f766e, #7c2d12); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
                .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0f766e; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                .warning { color: #dc2626; font-weight: bold; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>🔐 Admin Portal Login</h1>
                </div>
                <div class="content">
                  <p>Hello Admin,</p>
                  
                  <p>This is a confirmation that you've successfully logged into the <strong>Omanut Technologies Admin Portal</strong>.</p>
                  
                  <div class="info-box">
                    <p><strong>Login Details:</strong></p>
                    <ul>
                      <li><strong>Email:</strong> ${email}</li>
                      <li><strong>Time:</strong> ${new Date(timestamp).toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}</li>
                      ${ipAddress ? `<li><strong>IP Address:</strong> ${ipAddress}</li>` : ''}
                    </ul>
                  </div>
                  
                  <p class="warning">⚠️ If this wasn't you, please contact support immediately.</p>
                  
                  <p>Best regards,<br>
                  <strong>Omanut Technologies Security Team</strong></p>
                </div>
                <div class="footer">
                  <p>This is an automated security notification from Omanut Assistant</p>
                  <p>© 2025 Omanut Technologies. Transforming Zambian businesses with AI.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      }),
    });

    const result = await emailResponse.json();
    
    if (!emailResponse.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(result)}`);
    }

    console.log("Admin login notification sent:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending admin login notification:", error);
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
