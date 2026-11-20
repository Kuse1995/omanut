import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Platform = "linkedin" | "linkedin_pages" | "tiktok";
const LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  linkedin_pages: "LinkedIn Company Page",
  tiktok: "TikTok",
};

type State =
  | { kind: "working" }
  | { kind: "signin" }
  | { kind: "done"; accountName: string | null; warning?: string }
  | { kind: "error"; message: string };

/**
 * LinkedIn / TikTok redirect here with ?code&state (or ?error). The signed-in user's
 * session finishes the connection server-side; nothing secret is passed to the opener.
 */
const SocialOAuthCallback = ({ platform }: { platform: Platform }) => {
  const [state, setState] = useState<State>({ kind: "working" });
  const [hasSession, setHasSession] = useState(false);
  const started = useRef(false);
  const label = LABEL[platform];

  useEffect(() => {
    if (started.current) return; // codes are single-use; guard against double effects
    started.current = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const providerError = params.get("error_description") || params.get("error");
      const code = params.get("code");
      const oauthState = params.get("state");
      if (providerError) return setState({ kind: "error", message: providerError });
      if (!code || !oauthState) return setState({ kind: "error", message: "The sign-in response was incomplete. Start again from Setup." });

      // Connect-link handshakes finish without an Omanut session; the server decides.
      const { data: sessionData } = await supabase.auth.getSession();
      setHasSession(Boolean(sessionData.session));

      const fnName = platform === "tiktok" ? "tiktok-oauth-callback" : "linkedin-oauth-callback";
      const { data, error } = await supabase.functions.invoke(fnName, { body: { code, state: oauthState } });
      if (error) {
        let message = error.message;
        let code: string | undefined;
        if (error instanceof FunctionsHttpError) {
          try {
            const body = await error.context.json();
            message = body?.error?.message || message;
            code = body?.error?.code;
          } catch { /* keep default */ }
        }
        if (code === "unauthorized") return setState({ kind: "signin" });
        return setState({ kind: "error", message });
      }
      setState({ kind: "done", accountName: data?.account_name ?? null, warning: data?.warning });
      try {
        if (window.opener && !window.opener.closed) {
          // Only a "refresh now" signal; no codes or tokens leave this page.
          window.opener.postMessage({ source: "social-oauth", platform, ok: true }, "*");
          window.setTimeout(() => window.close(), 1500);
        }
      } catch { /* opener on another origin or closed */ }
    })();
  }, [platform]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        {state.kind === "working" && (
          <>
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
            <p className="text-lg font-medium">Finishing {label} connection…</p>
          </>
        )}
        {state.kind === "signin" && (
          <>
            <XCircle className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-lg font-medium">Sign in to finish connecting {label}</p>
            <p className="text-sm text-muted-foreground">
              You're not signed in on this site. Sign in, then press Connect {label} again on the Setup page.
            </p>
            <Button asChild><Link to="/login">Sign in</Link></Button>
          </>
        )}
        {state.kind === "done" && (
          <>
            <CheckCircle2 className="w-8 h-8 mx-auto text-primary" />
            <p className="text-lg font-medium">{label} connected{state.accountName ? ` as ${state.accountName}` : ""}</p>
            {state.warning && <p className="text-sm text-muted-foreground">{state.warning}</p>}
            {hasSession
              ? <Button variant="outline" asChild><Link to="/setup">Back to Setup</Link></Button>
              : <p className="text-sm text-muted-foreground">All done — you can close this page.</p>}
          </>
        )}
        {state.kind === "error" && (
          <>
            <XCircle className="w-8 h-8 mx-auto text-destructive" />
            <p className="text-lg font-medium">Couldn't connect {label}</p>
            <p className="text-sm text-muted-foreground break-words">{state.message}</p>
            {hasSession && <Button variant="outline" asChild><Link to="/setup">Back to Setup</Link></Button>}
          </>
        )}
      </div>
    </div>
  );
};

export default SocialOAuthCallback;
