/**
 * Returns a generic, safe error message for client responses.
 * Logs the real error server-side for debugging.
 */
export function safeErrorMessage(error: unknown, context?: string): string {
  // Log the real error for debugging
  if (context) {
    console.error(`[${context}] Error:`, error);
  }
  return 'An error occurred processing your request';
}

/**
 * Creates a safe JSON error response with CORS headers.
 */
export function safeErrorResponse(
  error: unknown,
  corsHeaders: Record<string, string>,
  context?: string,
  status = 500
): Response {
  const message = safeErrorMessage(error, context);
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
