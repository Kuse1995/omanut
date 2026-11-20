import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Linkedin, Loader2, Music2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const LABEL = { linkedin: "LinkedIn", linkedin_pages: "LinkedIn Company Page", tiktok: "TikTok" } as const;
type Platform = keyof typeof LABEL;

/**
 * Landing page for one-time connect links sent to a business owner (e.g. over WhatsApp).
 * The signed link is exchanged server-side for the provider's sign-in page; no Omanut login needed.
 */
const SocialConnectLink = () => {
  const { platform: raw } = useParams();
  const [params] = useSearchParams();
  const platform: Platform | null = raw === "linkedin" || raw === "linkedin_pages" || raw === "tiktok" ? raw : null;
  const token = params.get("t");
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!platform) return setError("This link is for an unknown app.");
    if (!token) return setError("This link is incomplete. Ask for a new one.");
    (async () => {
      const { data, error: fnError } = await supabase.functions.invoke("social-oauth-start", { body: { link_token: token } });
      if (fnError) {
        let message = "This link is invalid or has expired. Ask for a new one.";
        if (fnError instanceof FunctionsHttpError) {
          try { message = (await fnError.context.json())?.error?.message || message; } catch { /* keep default */ }
        }
        return setError(message);
      }
      setCompany(data?.company_name ?? null);
      if (data?.authorize_url) window.location.assign(data.authorize_url);
      else setError("Couldn't start the connection. Ask for a new link.");
    })();
  }, [platform, token]);

  const label = platform ? LABEL[platform] : "your account";
  const Icon = platform === "tiktok" ? Music2 : Linkedin;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        {error ? (
          <>
            <XCircle className="w-8 h-8 mx-auto text-destructive" />
            <p className="text-lg font-medium">Couldn't open this link</p>
            <p className="text-sm text-muted-foreground break-words">{error}</p>
            <Button variant="outline" onClick={() => window.close()}>Close</Button>
          </>
        ) : (
          <>
            <Icon className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-lg font-medium">Connecting {label}{company ? ` to ${company}` : ""}…</p>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Taking you to {label} to sign in
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default SocialConnectLink;
