## Two questions, two answers

### 1. Can ANZ log in / sign up with a new password?
**Yes — already supported, no code changes needed.** The new self-serve flow (built last loop) gives the ANZ owner three ways in:

- **Brand-new password**: Go to `/signup` → enter email + password → verify email → land on `/claim-company` → paste the ANZ claim code (visible to you in **Admin → Companies → Claim Codes**) → instantly becomes owner of ANZ.
- **Google sign-in**: Click "Continue with Google" on `/login` or `/signup` → same `/claim-company` step → done. No password to remember.
- **Forgot password (existing accounts)**: `/login` → "Forgot?" → email link → `/reset-password`.

**What you need to do for ANZ specifically:**
1. Open Admin → Companies → find ANZ → copy its claim code.
2. Send it to the ANZ owner over WhatsApp with the link `omanut.lovable.app/signup`.
3. They sign up (Google or email/password), paste the code, and they own the account. The old admin-created password becomes irrelevant.

No engineering work required for this part.

### 2. Image generation & media library on the client side

**Status today:** Both panels already render inside `/settings` under the **Media** tab (`CompanyMedia` + `ImageGenerationSettings`). They work for clients — but they're buried, so most owners never find them.

**Proposed change:** Promote them to a dedicated, first-class client page so ANZ (and everyone else) can manage product photos and AI image generation without digging through Settings.

#### Plan

1. **New route `/media`** with a clean two-tab layout:
   - **Library** — upload / tag / delete product, logo and promotional photos (`CompanyMedia`).
   - **AI Image Generation** — toggle, business context, style, reference photo picker (`ImageGenerationSettings`).
   - Wrapped in `ClientLayout` so it gets the sidebar + mobile bottom nav.

2. **Sidebar entry** in `src/components/dashboard/ClientSidebar.tsx`:
   - Add `{ name: "Media & Images", href: "/media", icon: ImageIcon }` between **Inbox** and **Conversations**.
   - Same icon shows up in `MobileBottomNav` if it's in the primary list.

3. **Setup card deep-link**: the existing **Brand Kit** card on `/setup` currently routes to `/settings`. Repoint it to `/media` so the onboarding flow lands the user directly on the right page.

4. **Settings cleanup**: leave the Media tab in `/settings` for now (back-compat), but show a small banner "Manage media on the new Media page →" linking to `/media`. We can remove the tab in a later pass.

#### Files to touch
- **New**: `src/pages/MediaStudio.tsx` (≈60 lines, just composition).
- **Edit**: `src/App.tsx` — add `/media` route.
- **Edit**: `src/components/dashboard/ClientSidebar.tsx` — add nav item.
- **Edit**: `src/pages/Setup.tsx` — Brand Kit card `onClick` → `/media`.
- **Edit**: `src/pages/Settings.tsx` — add link banner in Media tab.

No DB / edge function / RLS changes — both components already use `companyId` and existing RLS policies.

### Out of scope (ask if you want it)
- A "Generate now" button on `/media` that calls the image-gen edge function directly from the client UI (today AI generates only via WhatsApp / Boss Chat).
- Showing the gallery of past `generated_images` for the company.

Approve and I'll ship the four file edits + new page.