import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/context/CompanyContext";
import ClientLayout from "@/components/dashboard/ClientLayout";
import {
  BUSINESS_TYPES,
  CURRENCIES,
  EMPTY_DRAFT,
  HOURS_PRESETS,
  INDUSTRY_PRESETS,
  VOICE_TONES,
  WizardDraft,
} from "@/lib/wizardSteps";
import { cn } from "@/lib/utils";

interface StepDef {
  key: keyof WizardDraft | "review" | "boss";
  title: string;
  helper?: string;
  optional?: boolean;
}

const STEPS: StepDef[] = [
  { key: "name", title: "What's your business called?", helper: "We'll show this to your customers." },
  { key: "business_type", title: "What kind of business is it?", helper: "Pick the closest — we'll prefill smart defaults you can tweak." },
  { key: "services", title: "What do you sell or offer?", helper: "List your top products or services. Comma-separated is fine." },
  { key: "hours", title: "When are you open?", helper: "Pick a preset or type your own hours." },
  { key: "branches", title: "Any branches or locations?", helper: "Just one? Leave it as 'Main'." },
  { key: "currency_prefix", title: "Which currency do you use?", helper: "Used in quotes and payment messages." },
  { key: "voice_style", title: "How should your AI sound?", helper: "You can fine-tune the wording later." },
  { key: "boss", title: "Who should we notify?", helper: "Your WhatsApp number for handoffs and alerts.", optional: true },
  { key: "quick_reference_info", title: "Anything else the AI should know?", helper: "Delivery rules, cancellation policy, FAQs — anything.", optional: true },
  { key: "review", title: "Review & finish", helper: "Looks good? You can edit any of this later from Settings." },
];

const draftKey = (companyId: string) => `wizard-draft-${companyId}`;

const SetupWizard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedCompany, refreshCompanies } = useCompany();
  const [stepIdx, setStepIdx] = useState(0);
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load existing company values + any local draft
  useEffect(() => {
    if (!selectedCompany) return;
    const c = selectedCompany as any;
    const local = (() => {
      try {
        const raw = localStorage.getItem(draftKey(selectedCompany.id));
        return raw ? (JSON.parse(raw) as Partial<WizardDraft>) : {};
      } catch {
        return {};
      }
    })();
    setDraft({
      ...EMPTY_DRAFT,
      name: c.name ?? "",
      business_type: c.business_type ?? "",
      services: c.services ?? "",
      hours: c.hours ?? "",
      branches: c.branches ?? "Main",
      currency_prefix: c.currency_prefix ?? "K",
      voice_style: c.voice_style ?? "",
      quick_reference_info: c.quick_reference_info ?? "",
      ...local,
    });
    setLoading(false);
  }, [selectedCompany]);

  // Persist locally on change
  useEffect(() => {
    if (!selectedCompany) return;
    try {
      localStorage.setItem(draftKey(selectedCompany.id), JSON.stringify(draft));
    } catch {}
  }, [draft, selectedCompany]);

  const step = STEPS[stepIdx];
  const total = STEPS.length;

  const update = <K extends keyof WizardDraft>(k: K, v: WizardDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const applyIndustryPreset = (type: string) => {
    const preset = INDUSTRY_PRESETS[type];
    setDraft((d) => ({
      ...d,
      business_type: type,
      // Only fill empty fields so we don't clobber user edits
      services: d.services || preset.services,
      hours: d.hours || preset.hours,
      branches: d.branches && d.branches !== "Main" ? d.branches : preset.branches,
      service_locations: undefined as any,
      currency_prefix: d.currency_prefix || preset.currency_prefix,
      voice_style: d.voice_style || preset.voice_style,
    }));
  };

  const isValid = useMemo(() => {
    switch (step.key) {
      case "name":
        return draft.name.trim().length >= 2 && draft.name.length <= 100;
      case "business_type":
        return !!draft.business_type;
      case "services":
        return draft.services.trim().length > 0;
      case "hours":
        return draft.hours.trim().length > 0;
      case "branches":
        return draft.branches.trim().length > 0;
      case "currency_prefix":
        return draft.currency_prefix.trim().length > 0;
      case "voice_style":
        return draft.voice_style.trim().length > 0;
      case "boss":
        return step.optional || draft.boss_phone.trim().length >= 8;
      case "quick_reference_info":
      case "review":
        return true;
      default:
        return true;
    }
  }, [step, draft]);

  const persistStep = async (): Promise<boolean> => {
    if (!selectedCompany) return false;
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      switch (step.key) {
        case "name": updates.name = draft.name.trim(); break;
        case "business_type": updates.business_type = draft.business_type; break;
        case "services": updates.services = draft.services.trim(); break;
        case "hours": updates.hours = draft.hours.trim(); break;
        case "branches": updates.branches = draft.branches.trim(); break;
        case "currency_prefix": updates.currency_prefix = draft.currency_prefix.trim(); break;
        case "voice_style": updates.voice_style = draft.voice_style.trim(); break;
        case "quick_reference_info":
          updates.quick_reference_info = draft.quick_reference_info.trim() || null; break;
        case "boss": {
          if (draft.boss_phone.trim()) {
            const phone = draft.boss_phone.trim();
            const role = draft.boss_role;
            const presets: Record<string, any> = {
              owner: { notify_reservations: true, notify_payments: true, notify_alerts: true, notify_social_media: true, notify_content_approval: true },
              manager: { notify_reservations: true, notify_payments: true, notify_alerts: true, notify_social_media: false, notify_content_approval: true },
              accountant: { notify_reservations: false, notify_payments: true, notify_alerts: false, notify_social_media: false, notify_content_approval: false },
            };
            // Upsert by (company_id, phone)
            const { data: existing } = await supabase
              .from("company_boss_phones")
              .select("id")
              .eq("company_id", selectedCompany.id)
              .eq("phone", phone)
              .maybeSingle();
            const payload = {
              company_id: selectedCompany.id,
              phone,
              label: role.charAt(0).toUpperCase() + role.slice(1),
              role,
              role_label: role.charAt(0).toUpperCase() + role.slice(1),
              is_primary: true,
              ...presets[role],
            };
            if (existing) {
              await supabase.from("company_boss_phones").update(payload).eq("id", existing.id);
            } else {
              await supabase.from("company_boss_phones").insert(payload);
            }
          }
          break;
        }
        case "review":
          break;
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from("companies")
          .update(updates)
          .eq("id", selectedCompany.id);
        if (error) throw error;
      }
      return true;
    } catch (err: any) {
      toast({ title: "Couldn't save", description: err.message ?? "Try again", variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    const ok = await persistStep();
    if (!ok) return;
    if (stepIdx === total - 1) {
      // Done
      try { localStorage.removeItem(draftKey(selectedCompany!.id)); } catch {}
      await refreshCompanies();
      toast({ title: "Profile saved", description: "Your AI assistant is ready to chat." });
      navigate("/dashboard");
    } else {
      setStepIdx((i) => i + 1);
    }
  };

  const handleSkip = () => {
    if (stepIdx < total - 1) setStepIdx((i) => i + 1);
  };

  const handleBack = () => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };

  if (loading || !selectedCompany) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="min-h-[calc(100vh-4rem)] flex flex-col p-4 sm:p-6 lg:p-8 pb-32 md:pb-8 max-w-2xl mx-auto w-full">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => navigate("/setup")}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> Exit
            </button>
            <span className="text-xs text-muted-foreground">
              Step {stepIdx + 1} of {total}
            </span>
          </div>
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  i < stepIdx ? "bg-primary" : i === stepIdx ? "bg-primary/70" : "bg-muted",
                )}
              />
            ))}
          </div>
        </div>

        {/* Question */}
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
            {step.title}
          </h1>
          {step.helper && (
            <p className="text-muted-foreground mb-8">{step.helper}</p>
          )}

          {/* Step body */}
          <div className="space-y-4">
            {step.key === "name" && (
              <Input
                autoFocus
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="e.g. Bella Vista Restaurant"
                maxLength={100}
                className="text-lg h-12"
              />
            )}

            {step.key === "business_type" && (
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => applyIndustryPreset(t.value)}
                    className={cn(
                      "p-4 rounded-lg border text-left transition-all hover:border-primary/50",
                      draft.business_type === t.value
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card",
                    )}
                  >
                    <span className="font-medium">{t.label}</span>
                  </button>
                ))}
              </div>
            )}

            {step.key === "services" && (
              <Textarea
                autoFocus
                value={draft.services}
                onChange={(e) => update("services", e.target.value)}
                placeholder="e.g. Grilled fish, steaks, pasta, salads"
                rows={4}
                maxLength={1000}
                className="text-base"
              />
            )}

            {step.key === "hours" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {HOURS_PRESETS.map((h) => (
                    <button
                      key={h}
                      onClick={() => update("hours", h)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-sm border transition-colors",
                        draft.hours === h
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                <Input
                  value={draft.hours}
                  onChange={(e) => update("hours", e.target.value)}
                  placeholder="Or type your own…"
                  className="text-base h-11"
                />
              </>
            )}

            {step.key === "branches" && (
              <Input
                autoFocus
                value={draft.branches}
                onChange={(e) => update("branches", e.target.value)}
                placeholder="e.g. Main, Cairo Road, Manda Hill"
                className="text-base h-11"
              />
            )}

            {step.key === "currency_prefix" && (
              <div className="grid grid-cols-2 gap-2">
                {CURRENCIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => update("currency_prefix", c.value)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all",
                      draft.currency_prefix === c.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {step.key === "voice_style" && (
              <div className="space-y-2">
                {VOICE_TONES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => update("voice_style", t.value)}
                    className={cn(
                      "w-full p-4 rounded-lg border text-left transition-all",
                      draft.voice_style === t.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="font-medium">{t.label}</div>
                    <div className="text-sm text-muted-foreground mt-0.5">{t.value}</div>
                  </button>
                ))}
              </div>
            )}

            {step.key === "boss" && (
              <div className="space-y-3">
                <Input
                  type="tel"
                  value={draft.boss_phone}
                  onChange={(e) => update("boss_phone", e.target.value)}
                  placeholder="e.g. +260 977 123 456"
                  className="text-base h-11"
                />
                <div className="flex gap-2">
                  {(["owner", "manager", "accountant"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => update("boss_role", r)}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg border text-sm capitalize transition-colors",
                        draft.boss_role === r
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  We'll WhatsApp this number when the AI needs help or a customer asks for you.
                </p>
              </div>
            )}

            {step.key === "quick_reference_info" && (
              <Textarea
                autoFocus
                value={draft.quick_reference_info}
                onChange={(e) => update("quick_reference_info", e.target.value)}
                placeholder="e.g. We deliver within 5 km for free. No refunds after 24 hours."
                rows={6}
                className="text-base"
              />
            )}

            {step.key === "review" && (
              <Card className="p-4 space-y-3 bg-muted/30">
                <ReviewRow label="Name" value={draft.name} />
                <ReviewRow label="Type" value={BUSINESS_TYPES.find(t => t.value === draft.business_type)?.label ?? draft.business_type} />
                <ReviewRow label="Sells" value={draft.services} />
                <ReviewRow label="Hours" value={draft.hours} />
                <ReviewRow label="Branches" value={draft.branches} />
                <ReviewRow label="Currency" value={draft.currency_prefix} />
                <ReviewRow label="Voice" value={VOICE_TONES.find(t => t.value === draft.voice_style)?.label ?? "Custom"} />
                {draft.boss_phone && (
                  <ReviewRow label="Notify" value={`${draft.boss_phone} (${draft.boss_role})`} />
                )}
                {draft.quick_reference_info && (
                  <ReviewRow label="Notes" value={draft.quick_reference_info} />
                )}
                <div className="pt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="w-4 h-4 text-primary" />
                  All set — your AI is ready to roll.
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="fixed bottom-0 left-0 right-0 md:static md:mt-10 bg-background/95 backdrop-blur md:bg-transparent border-t md:border-0 p-4 md:p-0">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={stepIdx === 0 || saving}
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div className="flex items-center gap-2">
              {step.optional && stepIdx < total - 1 && (
                <Button variant="ghost" onClick={handleSkip} disabled={saving}>
                  Skip
                </Button>
              )}
              <Button onClick={handleNext} disabled={!isValid || saving} className="min-w-32">
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : stepIdx === total - 1 ? (
                  <>
                    <Check className="w-4 h-4 mr-1" /> Finish
                  </>
                ) : (
                  <>
                    Continue <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ClientLayout>
  );
};

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4 text-sm">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="text-right font-medium line-clamp-2">{value || "—"}</span>
  </div>
);

export default SetupWizard;
