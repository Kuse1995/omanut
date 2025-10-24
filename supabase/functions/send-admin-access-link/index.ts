import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const AUTHORIZED_ADMIN_EMAIL = "Abkanyanta@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AccessLinkRequest {
  email: string;
  accessToken: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, accessToken }: AccessLinkRequest = await req.json();
    
    console.log("Admin access link request for:", email);

    // Validate email
    if (email.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
      console.log("Unauthorized email attempt:", email);
      return new Response(
        JSON.stringify({ error: "Unauthorized email" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessLink = `${req.headers.get("origin") || "https://omanut-assistant.lovable.app"}/admin/verify?token=${accessToken}`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #047857;">Omanut Admin Portal Access</h1>
        <p>Hello,</p>
        <p>You requested access to the Omanut Admin Portal.</p>
        <p>Click the button below to access the admin dashboard:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${accessLink}" style="background: linear-gradient(90deg, #047857, #dc2626); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
            Access Admin Portal
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">This link will expire in 15 minutes.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request this, please ignore this email.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">© 2025 Omanut Technologies</p>
      </div>
    `;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Omanut Admin <onboarding@resend.dev>",
        to: [email],
        subject: "Admin Portal Access Link",
        html: emailHtml,
      }),
    });

    if (!resendResponse.ok) {
      const error = await resendResponse.text();
      console.error("Resend API error:", error);
      throw new Error(`Failed to send email: ${error}`);
    }

    const result = await resendResponse.json();
    console.log("Access link email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Access link sent to your email" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-admin-access-link:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
