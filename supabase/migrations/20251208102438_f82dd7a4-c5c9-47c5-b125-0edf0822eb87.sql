-- Remove the overly permissive "System can update payment transactions" policy
-- Edge functions use service_role key which bypasses RLS, so this policy is unnecessary
DROP POLICY IF EXISTS "System can update payment transactions" ON payment_transactions;