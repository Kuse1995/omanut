// Single source of truth for the default row a NEW company gets.
// Used by the dashboard's create-company function AND the mcp-server
// create_company tool so both paths produce an identical company.
// Everything not listed here (currency_prefix 'K', subscription_tier 'starter',
// openclaw_owns, agent_routing_enabled true, booking_buffer_minutes 15,
// credit_balance 1000, is_live false, ...) comes from the companies column
// defaults in the database — do not duplicate them here.
export const DASHBOARD_COMPANY_DEFAULTS = {
  test_mode: true,
} as const;
