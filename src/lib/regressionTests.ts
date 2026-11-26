import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface RegressionTestCase {
  id: string;
  company_id: string;
  name: string;
  prompt: string;
  expected_behavior: string | null;
  must_include: string[];
  must_not_include: string[];
  source_error_id?: string | null;
  source_violation_id?: string | null;
  last_run_at?: string | null;
  last_passed?: boolean | null;
  last_response?: string | null;
  last_model?: string | null;
  created_at: string;
}

export interface CreateRegressionTestInput {
  name: string;
  prompt: string;
  expected_behavior?: string | null;
  must_include?: string[];
  must_not_include?: string[];
  source_error_id?: string | null;
  source_violation_id?: string | null;
}

export interface RegressionRunResult {
  last_run_at: string;
  last_passed: boolean;
  last_response: string;
  last_model: string | null;
}

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(e.code || "");
  const msg = String(e.message || e.details || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("ai_regression_tests")
  );
}

async function readMetadataTests(companyId: string): Promise<RegressionTestCase[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("metadata")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  const md = (data?.metadata as Record<string, unknown> | null) || {};
  const list = md.regression_tests;
  return Array.isArray(list) ? (list as RegressionTestCase[]) : [];
}

async function writeMetadataTests(companyId: string, tests: RegressionTestCase[]): Promise<void> {
  const { data, error: readErr } = await supabase
    .from("companies")
    .select("metadata")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr) throw readErr;
  const md = (data?.metadata as Record<string, unknown> | null) || {};
  const updated = { ...md, regression_tests: tests } as unknown as Json;
  const { error } = await supabase.from("companies").update({ metadata: updated }).eq("id", companyId);
  if (error) throw error;
}

export async function listRegressionTests(companyId: string): Promise<RegressionTestCase[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("ai_regression_tests")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (!error) {
    return (data || []) as RegressionTestCase[];
  }
  if (!isMissingTableError(error)) {
    throw error;
  }
  return readMetadataTests(companyId);
}

export async function createRegressionTest(
  companyId: string,
  input: CreateRegressionTestInput
): Promise<RegressionTestCase> {
  const payload = {
    company_id: companyId,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    expected_behavior: input.expected_behavior?.trim() || null,
    must_include: (input.must_include || []).map((s) => s.trim()).filter(Boolean),
    must_not_include: (input.must_not_include || []).map((s) => s.trim()).filter(Boolean),
    source_error_id: input.source_error_id || null,
    source_violation_id: input.source_violation_id || null,
  };

  const { data: userRes } = await supabase.auth.getUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("ai_regression_tests")
    .insert({ ...payload, created_by: userRes.user?.id ?? null })
    .select("*")
    .single();

  if (!error && data) {
    return data as RegressionTestCase;
  }
  if (!isMissingTableError(error)) {
    throw error;
  }

  const existing = await readMetadataTests(companyId);
  const created: RegressionTestCase = {
    id: crypto.randomUUID(),
    ...payload,
    last_run_at: null,
    last_passed: null,
    last_response: null,
    last_model: null,
    created_at: new Date().toISOString(),
  };
  await writeMetadataTests(companyId, [created, ...existing]);
  return created;
}

export async function updateRegressionTestResult(
  companyId: string,
  id: string,
  result: RegressionRunResult
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("ai_regression_tests")
    .update({
      last_run_at: result.last_run_at,
      last_passed: result.last_passed,
      last_response: result.last_response,
      last_model: result.last_model,
    })
    .eq("id", id)
    .eq("company_id", companyId);

  if (!error) return;
  if (!isMissingTableError(error)) {
    throw error;
  }

  const existing = await readMetadataTests(companyId);
  const updated = existing.map((t) => (t.id === id ? { ...t, ...result } : t));
  await writeMetadataTests(companyId, updated);
}

export async function deleteRegressionTest(companyId: string, id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("ai_regression_tests")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);

  if (!error) return;
  if (!isMissingTableError(error)) {
    throw error;
  }

  const existing = await readMetadataTests(companyId);
  await writeMetadataTests(
    companyId,
    existing.filter((t) => t.id !== id)
  );
}
