import { useEffect } from 'react';

/**
 * OAuth callback page for Facebook Login for Business.
 *
 * Meta redirects the popup window here with ?code=... &state=... (or &error=...).
 * We post the result back to the opener and close the popup. No UI logic here —
 * the parent window (MetaIntegrationsPanel) does the rest.
 */
const MetaOAuthCallback = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error =
      params.get('error_description') ||
      params.get('error_message') ||
      params.get('error');

    const payload = {
      source: 'meta-oauth' as const,
      code,
      state,
      error,
    };

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, window.location.origin);
      }
    } catch (e) {
      console.error('[MetaOAuthCallback] postMessage failed', e);
    }

    // Give the message a moment to flush, then close.
    const t = window.setTimeout(() => {
      window.close();
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="text-center space-y-2">
        <p className="text-lg font-medium">Finishing Facebook connection…</p>
        <p className="text-sm text-muted-foreground">You can close this window.</p>
      </div>
    </div>
  );
};

export default MetaOAuthCallback;
