/**
 * Tenant Context Utilities for Edge Functions
 * 
 * These utilities enforce the invariant that background jobs
 * can only act on the company that owns the record.
 * 
 * NEVER accept company_id from user input in scheduled/worker jobs.
 * ALWAYS load it from the database record being processed.
 */

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/**
 * Asserts that a company_id is present and valid.
 * Use in background jobs to ensure tenant isolation.
 * 
 * @param companyId - The company_id loaded from the database record
 * @param context - Description of the operation for error messages
 * @throws TenantContextError if company_id is missing
 */
export function assertTenantContext(
  companyId: string | null | undefined,
  context: string
): asserts companyId is string {
  if (!companyId) {
    throw new TenantContextError(
      `Tenant isolation violation in ${context}: No company_id found on record. ` +
      `Jobs must only operate on records with valid company ownership.`
    );
  }
}

/**
 * Validates that the company_id from a record matches expected value.
 * Use when processing related records to prevent cross-tenant access.
 * 
 * @param recordCompanyId - The company_id from the record
 * @param expectedCompanyId - The company_id expected from parent context
 * @param context - Description for error messages
 * @throws TenantContextError if company_ids don't match
 */
export function assertTenantMatch(
  recordCompanyId: string | null | undefined,
  expectedCompanyId: string,
  context: string
): void {
  if (!recordCompanyId) {
    throw new TenantContextError(
      `Tenant isolation violation in ${context}: Record has no company_id.`
    );
  }
  
  if (recordCompanyId !== expectedCompanyId) {
    throw new TenantContextError(
      `Tenant isolation violation in ${context}: ` +
      `Record belongs to company ${recordCompanyId} but expected ${expectedCompanyId}. ` +
      `This may indicate a cross-tenant access attempt.`
    );
  }
}

/**
 * Helper to load company context from a database record.
 * Ensures the company_id comes from DB, not user input.
 * 
 * @param record - The database record containing company_id
 * @param recordType - Type of record for error messages
 * @returns The validated company_id
 * @throws TenantContextError if company_id is missing
 */
export function loadTenantFromRecord<T extends { company_id?: string | null }>(
  record: T,
  recordType: string
): string {
  assertTenantContext(record.company_id, `loading ${recordType}`);
  return record.company_id;
}

/**
 * Creates a tenant-scoped query filter for Supabase.
 * Use to ensure all queries in a job are properly scoped.
 * 
 * @param companyId - The validated company_id
 * @returns Query filter object
 */
export function tenantFilter(companyId: string) {
  return { company_id: companyId };
}
