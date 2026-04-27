# Conversational Setup Wizard

Replace the wall-of-fields company form (and the static `/setup` cards) with a friendly, one-question-at-a-time wizard. Think Typeform / iOS onboarding: big question, focused input, progress dots, "Back" + "Next", auto-save as you go.

The existing `CompanyForm` stays for admins (Omanut staff editing companies in the back office). Clients get the wizard.

## What the user sees

```text
┌─────────────────────────────────────┐
│  ●●●○○○○○○○         step 3 of 10    │
│                                     │
│  What does your business sell?      │
│  We'll use this to train your AI.   │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ e.g. Grilled fish, steaks…  │    │
│  └─────────────────────────────┘    │
│                                     │
│  💡 Tip: list your top sellers      │
│                                     │
│  [ Back ]            [ Continue → ] │
└─────────────────────────────────────┘
```

- One question per screen, large input, helper text + example.
- Progress dots at top, "step X of Y".
- Auto-saves after each step (so a refresh resumes where they left off).
- "Skip for now" on optional steps.
- Final step: summary card → "Looks good, finish" → returns them to `/dashboard` with the Setup Checklist updated.

## Question flow (10 steps)

Grouped so the most important things come first:

1. **Business name** — text
2. **Business type** — chips (Restaurant, Clinic, Retail, Salon, Hotel, School, Other) → auto-fills sensible defaults for steps 4–7
3. **What you sell / services offered** — textarea, prefilled from type
4. **Operating hours** — quick presets (24/7, Mon-Fri 9-5, Custom)
5. **Branches / locations** — text, default "Main"
6. **Currency** — chips (K, $, R, KSh, Other)
7. **Voice & tone** — chips (Warm, Professional, Playful, Direct) → maps to `voice_style`
8. **Who should we notify?** — phone + role chip (Owner / Manager / Accountant); can add more later
9. **Anything else the AI should know?** — free textarea → `quick_reference_info` (skippable)
10. **Review & finish** — summary list with inline edit links

Steps 4–7 use the existing `industryConfig` presets from `CompanyForm.tsx` so picking "Restaurant" instantly fills realistic defaults the user can tweak.

## Where it lives

- Route: `/setup/wizard` (Setup hub gets a new "Complete business profile" card that launches it).
- First-time clients (any required field empty) are auto-routed there from `/dashboard` once, with a dismissible banner on subsequent visits.

## Files

**New**
- `src/pages/SetupWizard.tsx` — page shell, step state, progress, navigation
- `src/components/setup/wizard/WizardStep.tsx` — shared layout (question, helper, input slot, footer buttons)
- `src/components/setup/wizard/steps/` — one file per step (`StepName.tsx`, `StepBusinessType.tsx`, …)
- `src/hooks/useWizardDraft.ts` — loads/saves draft to `companies` row + `localStorage` fallback for resume
- `src/lib/wizardSteps.ts` — step list, validation per step, industry presets (lifted from `CompanyForm.tsx`)

**Edited**
- `src/App.tsx` — add `/setup/wizard` route inside `CompanyProtectedRoutes`
- `src/pages/Setup.tsx` — add a top-of-page "Complete your business profile" card that links to the wizard, hidden once profile is complete
- `src/pages/Dashboard.tsx` — first-load redirect when profile is incomplete (one-shot, then dismissible)
- `src/hooks/useSetupStatus.ts` — add a `profileComplete` boolean derived from required fields (name, business_type, services, hours, currency_prefix, voice_style)

**Untouched** (intentionally)
- `src/components/CompanyForm.tsx` — admin-only back-office form stays as-is
- WhatsApp/Twilio fields — wizard never asks (per the admin-only constraint we just locked in)

## Persistence

- On every "Continue", `update companies set <field> = …` for the selected company (uses existing RLS — owner can edit own company).
- Boss phones written via existing `company_boss_phones` insert with role presets (matching `CompanyForm` logic).
- Draft state mirrored to `localStorage` keyed by `company_id` so a mid-flow refresh resumes on the same step.

## Validation

- Per-step zod schemas (name max 100, services max 1000, phone E.164, etc.), inline error under the input. Continue button disabled until valid (except on skippable steps).

## Mobile

- Full-bleed on `<768px`, single column, sticky footer with Back/Continue. Designed first for the 745px viewport the user is on right now.

## Out of scope (for this pass)

- Editing answers later via the wizard (they'll use Settings tabs as today).
- AI-suggested answers ("we noticed your website says X — use that?"). Could add later if desired.

Approve and I'll build it.
