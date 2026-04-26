// Exchanges a Facebook OAuth code (or short-lived user token) for a long-lived user token,
// then lists the user's manageable Pages with their Page Access Tokens + linked Instagram accounts.
// Page tokens are cached server-side in meta_oauth_sessions and NEVER returned to the browser.
//
// Input: { code?: string, redirect_uri?: string, short_lived_token?: string, company_id: string }
// Output: { session_id, pages: [{ id, name, picture_url, ig_user_id, has_instagram }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FB_GRAPH = "https://graph.facebook.com/v19.0";

interface FbPage {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const APP_ID = Deno.env.get("META_APP_ID");
    const APP_SECRET = Deno.env.get("META_APP_SECRET");
    if (!APP_ID || !APP_SECRET) {
      return jsonError(
        500,
        "Meta App not configured. Add META_APP_ID and META_APP_SECRET secrets."
      );
    }

    // Authenticate the calling user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError(401, "Missing Authorization header");

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userRes } = await supabaseUser.auth.getUser();
    const user = userRes?.user;
    if (!user) return jsonError(401, "Invalid session");

    const body = await req.json().catch(() => ({}));
    const { code, redirect_uri, short_lived_token, company_id } = body ?? {};

    if (!company_id) return jsonError(400, "company_id is required");
    if (!code && !short_lived_token) {
      return jsonError(400, "Either 'code' or 'short_lived_token' is required");
    }

    // Verify the user belongs to this company (RLS-style check via service role)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: membership } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", company_id)
      .maybeSingle();

    if (!membership) {
      return jsonError(403, "You do not have access to this company");
    }

    // Step 1: get a user access token
    let userToken: string;

    if (code) {
      // Code from our /auth/meta/callback popup. The redirect_uri sent here
      // MUST exactly match the one used to obtain the code, otherwise Meta
      // returns "redirect_uri isn't an absolute URI" or a mismatch error.
      if (!redirect_uri) {
        return jsonError(400, "redirect_uri is required when exchanging a code");
      }
      const tokenUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
      tokenUrl.searchParams.set("client_id", APP_ID);
      tokenUrl.searchParams.set("client_secret", APP_SECRET);
      tokenUrl.searchParams.set("redirect_uri", redirect_uri);
      tokenUrl.searchParams.set("code", code);

      const tokenRes = await fetch(tokenUrl.toString());
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || tokenJson.error) {
        console.error("Code exchange failed:", tokenJson);
        return jsonError(400, tokenJson.error?.message ?? "Code exchange failed");
      }
      userToken = tokenJson.access_token;
    } else {
      userToken = short_lived_token;
    }

    // Step 2: upgrade to long-lived user token (60 days)
    const longUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", APP_ID);
    longUrl.searchParams.set("client_secret", APP_SECRET);
    longUrl.searchParams.set("fb_exchange_token", userToken);

    const longRes = await fetch(longUrl.toString());
    const longJson = await longRes.json();
    if (!longRes.ok || longJson.error) {
      console.error("Long-lived exchange failed:", longJson);
      return jsonError(400, longJson.error?.message ?? "Long-lived exchange failed");
    }
    const longLivedUserToken = longJson.access_token as string;

    // Step 3: list manageable Pages (and their picture + IG account)
    const pagesUrl = new URL(`${FB_GRAPH}/me/accounts`);
    pagesUrl.searchParams.set(
      "fields",
      "id,name,access_token,picture{url},instagram_business_account{id}"
    );
    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set("access_token", longLivedUserToken);

    const pagesRes = await fetch(pagesUrl.toString());
    const pagesJson = await pagesRes.json();
    if (!pagesRes.ok || pagesJson.error) {
      console.error("Pages fetch failed:", pagesJson);
      return jsonError(400, pagesJson.error?.message ?? "Pages fetch failed");
    }

    const fbPages: FbPage[] = pagesJson.data ?? [];
    if (fbPages.length === 0) {
      return jsonError(
        400,
        "No Facebook Pages found. Make sure the account you logged in with manages at least one Page."
      );
    }

    // Step 4: cache the page tokens server-side
    const cachedPages = fbPages.map((p) => ({
      id: p.id,
      name: p.name,
      picture_url: p.picture?.data?.url ?? null,
      access_token: p.access_token,
      ig_user_id: p.instagram_business_account?.id ?? null,
    }));

    const { data: session, error: sessionErr } = await supabase
      .from("meta_oauth_sessions")
      .insert({
        user_id: user.id,
        company_id,
        pages: cachedPages,
      })
      .select("id")
      .single();

    if (sessionErr || !session) {
      console.error("Session insert failed:", sessionErr);
      return jsonError(500, "Failed to create OAuth session");
    }

    // Step 5: return sanitized page list (NO tokens)
    const safePages = cachedPages.map((p) => ({
      id: p.id,
      name: p.name,
      picture_url: p.picture_url,
      has_instagram: Boolean(p.ig_user_id),
    }));

    return new Response(
      JSON.stringify({ session_id: session.id, pages: safePages }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("meta-oauth-exchange error:", err);
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
