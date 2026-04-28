## Goal

Stop having admins create client passwords. Let clients:
1. **Sign themselves up** (email+password or Google) at `/signup`.
2. **Claim an existing company** that was pre-created by the admin, so the 7 companies already in the system (ANZ, GreenGrid, Finch, E Library, etc.) get linked to a real client login the owner controls.
3. **Reset forgotten passwords** via email link.

Admins keep creating company *records*, but never touch passwords again.

---

## What changes for the user

### New client-facing pages
- **`/signup`** — Email+password form **+ "Continue with Google"** button. After signup, sends them to `/claim-company` if they have no company yet.
- **`/claim-company`** — Conversational step: "Which business is this?" Shows a searchable list of unclaimed companies. Client picks theirs → enters a one-time **claim code** (admin gives it to them, or it's auto-emailed) → they become the owner of that company.
- **`/forgot-password`** + **`/reset-password`** — Standard reset flow (currently missing).

### Login page (`/login`)
- Adds **"Continue with Google"** button.
- Adds **"Forgot password?"** link.
- Adds **"New here? Create an account"** link → `/signup`.

### Admin side (NewCompany / CompanyForm)
- **Remove** the `admin_email` and `admin_password` fields entirely.
- Replace with a single read-only **"Claim code"** that's auto-generated when the company is created (e.g. `ANZ-7K3F-92QX`). Admin copies this and shares it with the client over WhatsApp.
- Existing 7 companies get a claim code backfilled so you can hand them out today.

### Existing companies (the 7 already in the DB)
- A one-time migration generates a claim code for each.
- You'll see them in `/admin/companies` with a **"Copy claim code"** button.
- Send the code to each company owner; they sign up at `/signup`, claim, done. The old forgotten admin password becomes irrelevant.

---

## Technical details

### Database
New table `company_claim_codes`:
- `company_id` (FK, unique)
- `code` (text, unique, format `XXXX-XXXX-XXXX`)
- `claimed_by` (uuid, nullable — auth user who claimed it)
- `claimed_at` (timestamptz, nullable)
- `created_at`

RLS: only admins can SELECT/INSERT; the claim itself happens via a SECURITY DEFINER RPC `claim_company(_code text)` that:
- Looks up the code, errors if already claimed.
- Inserts the caller into `company_users` with role `owner`.
- Marks the code as claimed.
- Returns the `company_id`.

Backfill migration: insert one row per existing company in `companies`.

### Google auth
Uses Lovable Cloud's managed Google OAuth (no client ID/secret needed). On `/signup` and `/login`:
```ts
import { lovable } from "@/integrations/lovable";
await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/claim-company" });
```
After Google returns, if the user has no `company_users` row, route them to `/claim-company`. If they do, route to `/dashboard`.

### Password reset
- `/forgot-password`: calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + "/reset-password" })`.
- `/reset-password`: detects `type=recovery` in URL hash, shows new-password form, calls `supabase.auth.updateUser({ password })`.

### CompanyForm cleanup
Remove `admin_email` / `admin_password` state, validation, and the entire "Admin login" section. The `create-company` edge function stops accepting those fields and instead generates a claim code.

### Routing guard update
`Login.tsx` currently rejects users that aren't `client` role. Loosen this: if the user has a `company_users` row, treat them as a client (no need for the `client` role rpc). If they have no company, push to `/claim-company` instead of signing them out.

### Files touched
- **New**: `src/pages/Signup.tsx`, `src/pages/ClaimCompany.tsx`, `src/pages/ForgotPassword.tsx`, `src/pages/ResetPassword.tsx`
- **Modified**: `src/App.tsx` (4 routes), `src/pages/Login.tsx` (Google + forgot link + signup link, looser role check), `src/components/CompanyForm.tsx` (drop admin email/password), `supabase/functions/create-company/index.ts` (generate claim code, no auth user)
- **DB migration**: create `company_claim_codes` + `claim_company` RPC + backfill for the 7 existing companies
- **Memory**: update `mem://constraints/whatsapp-setup-admin-only` companion or add `mem://features/client-self-serve-signup` describing the claim-code flow

---

## Out of scope (ask if you want them)
- Magic-link-only signup (no password at all).
- SSO with Apple / Microsoft.
- Auto-emailing the claim code to a contact on the company record (we can add later — for now admin copies it manually).

Approve to build, or tell me what to change.