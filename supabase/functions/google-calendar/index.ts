import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// JWT token generation for Google service account
async function createJWT(serviceAccountEmail: string, privateKey: string): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedClaim = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  // Import private key - handle both escaped newlines and actual newlines
  const pemKey = privateKey.replace(/\\n/g, '\n');
  
  // Ensure proper PEM format with headers
  const keyWithHeaders = pemKey.includes('-----BEGIN PRIVATE KEY-----') 
    ? pemKey 
    : `-----BEGIN PRIVATE KEY-----\n${pemKey}\n-----END PRIVATE KEY-----`;
  
  // Extract only the base64 content between headers
  const base64Key = keyWithHeaders
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, ''); // Remove all whitespace including newlines
  
  console.log('[CALENDAR] Private key base64 length:', base64Key.length);
  
  const binaryDer = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signatureInput}.${signature}`;
}

async function getAccessToken(serviceAccountEmail: string, privateKey: string): Promise<string> {
  const jwt = await createJWT(serviceAccountEmail, privateKey);
  
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function checkAvailability(
  accessToken: string,
  calendarId: string,
  date: string,
  time: string,
  durationMinutes: number,
  bufferMinutes: number
): Promise<{ available: boolean; message: string; conflicts?: any[] }> {
  const [year, month, day] = date.split('-');
  const [hour, minute] = time.split(':');
  
  const startDateTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
  const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);
  
  // Add buffer time
  const searchStart = new Date(startDateTime.getTime() - bufferMinutes * 60000);
  const searchEnd = new Date(endDateTime.getTime() + bufferMinutes * 60000);

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
    `timeMin=${searchStart.toISOString()}&timeMax=${searchEnd.toISOString()}&singleEvents=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to check calendar: ${error}`);
  }

  const data = await response.json();
  const conflicts = data.items || [];

  if (conflicts.length > 0) {
    return {
      available: false,
      message: `Time slot unavailable. ${conflicts.length} conflict(s) found.`,
      conflicts: conflicts.map((e: any) => ({
        title: e.summary,
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
      })),
    };
  }

  return {
    available: true,
    message: "Time slot is available",
  };
}

async function createEvent(
  accessToken: string,
  calendarId: string,
  reservation: any,
  title: string,
  description: string,
  sendNotifications: boolean
): Promise<{ event_id: string; link: string }> {
  const [year, month, day] = reservation.date.split('-');
  const [hour, minute] = reservation.time.split(':');
  
  const startDateTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
  const endDateTime = new Date(startDateTime.getTime() + 120 * 60000); // Default 2 hours

  const event = {
    summary: title,
    description: description,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'Africa/Lusaka',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'Africa/Lusaka',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendNotifications ? 'all' : 'none'}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create event: ${error}`);
  }

  const data = await response.json();
  return {
    event_id: data.id,
    link: data.htmlLink,
  };
}

async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  reservation: any,
  title: string,
  description: string
): Promise<{ event_id: string; link: string }> {
  const [year, month, day] = reservation.date.split('-');
  const [hour, minute] = reservation.time.split(':');
  
  const startDateTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
  const endDateTime = new Date(startDateTime.getTime() + 120 * 60000);

  const event = {
    summary: title,
    description: description,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'Africa/Lusaka',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'Africa/Lusaka',
    },
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update event: ${error}`);
  }

  const data = await response.json();
  return {
    event_id: data.id,
    link: data.htmlLink,
  };
}

async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  sendNotifications: boolean
): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=${sendNotifications ? 'all' : 'none'}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok && response.status !== 410) { // 410 = already deleted
    const error = await response.text();
    throw new Error(`Failed to delete event: ${error}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Create authenticated client to verify the user
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const { action, companyId, date, time, duration, reservationId, eventId, title, description, sendNotifications } = await req.json();

    // Verify user has access to this company
    const { data: userCompany, error: userError } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    // Check if user is admin or has access to the company
    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    
    if (!isAdmin && (!userCompany || userCompany.company_id !== companyId)) {
      return new Response(
        JSON.stringify({ error: 'Not authorized for this company' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    console.log(`[CALENDAR] Authorized user ${user.id} for action: ${action}, Company: ${companyId}`);

    // Get company calendar settings
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('google_calendar_id, calendar_sync_enabled, booking_buffer_minutes')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      return new Response(
        JSON.stringify({ error: 'Company not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    if (!company.calendar_sync_enabled) {
      console.log(`[CALENDAR] Calendar sync disabled for company ${companyId}`);
      return new Response(
        JSON.stringify({ 
          error: 'Calendar sync is not enabled for this company',
          hint: 'Enable in Settings → Calendar Integration'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const serviceAccountEmail = Deno.env.get('GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_CALENDAR_PRIVATE_KEY');
    const calendarId = company.google_calendar_id || Deno.env.get('GOOGLE_CALENDAR_ID');

    if (!serviceAccountEmail || !privateKey || !calendarId) {
      console.error('[CALENDAR] Missing config:', { 
        hasEmail: !!serviceAccountEmail, 
        hasKey: !!privateKey, 
        hasCalendarId: !!calendarId 
      });
      return new Response(
        JSON.stringify({ error: 'Calendar integration not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`[CALENDAR] Action: ${action}, Company: ${companyId}, Calendar: ${calendarId}, Service Account: ${serviceAccountEmail}`);

    const accessToken = await getAccessToken(serviceAccountEmail, privateKey);

    if (action === 'check_availability') {
      const result = await checkAvailability(
        accessToken,
        calendarId,
        date,
        time,
        duration || 120,
        company.booking_buffer_minutes || 15
      );

      console.log(`[CALENDAR] Availability check for ${date} ${time}: ${result.available ? 'AVAILABLE' : 'BUSY'}`);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create_event') {
      const { data: reservation, error: resError } = await supabase
        .from('reservations')
        .select('*')
        .eq('id', reservationId)
        .single();

      if (resError || !reservation) {
        return new Response(
          JSON.stringify({ error: 'Reservation not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      const result = await createEvent(
        accessToken,
        calendarId,
        reservation,
        title,
        description || '',
        sendNotifications !== false
      );

      console.log(`[CALENDAR] Event created: ${result.event_id}`);

      // Update reservation with calendar info
      await supabase
        .from('reservations')
        .update({
          google_calendar_event_id: result.event_id,
          calendar_event_link: result.link,
          calendar_sync_status: 'synced',
        })
        .eq('id', reservationId);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update_event') {
      if (!eventId || !reservationId) {
        return new Response(
          JSON.stringify({ error: 'eventId and reservationId are required for update_event' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      const { data: reservation, error: resError } = await supabase
        .from('reservations')
        .select('*')
        .eq('id', reservationId)
        .single();

      if (resError || !reservation) {
        return new Response(
          JSON.stringify({ error: 'Reservation not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      const result = await updateEvent(
        accessToken,
        calendarId,
        eventId,
        reservation,
        title,
        description || ''
      );

      console.log(`[CALENDAR] Event updated: ${result.event_id}`);

      await supabase
        .from('reservations')
        .update({
          google_calendar_event_id: result.event_id,
          calendar_event_link: result.link,
          calendar_sync_status: 'synced',
        })
        .eq('id', reservationId);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'delete_event') {
      if (!eventId) {
        return new Response(
          JSON.stringify({ error: 'eventId is required for delete_event' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      await deleteEvent(
        accessToken,
        calendarId,
        eventId,
        sendNotifications !== false
      );

      console.log(`[CALENDAR] Event deleted: ${eventId}`);

      if (reservationId) {
        await supabase
          .from('reservations')
          .update({
            google_calendar_event_id: null,
            calendar_event_link: null,
            calendar_sync_status: 'cancelled',
          })
          .eq('id', reservationId);
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Event deleted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );

  } catch (error) {
    console.error('[CALENDAR] Error:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
