# Surface claim codes inside the admin workspace

## What's happening

You're using the new admin workspace at `/admin/dashboard` — it has the icon sidebar + Cmd-K company search and **no "Companies list" view**. The Claim Codes panel I added earlier lives on the legacy `/admin/companies` page, which isn't linked anywhere in the new sidebar. That's why you can't see it.

Two clean ways to fix it. Pick one:

### Option A — Add claim code to each company in Cmd-K results (fastest, most contextual)
When you search a company in the command palette, show its claim code right there with a one-click **Copy** button next to it (only if not yet claimed; show a green ✓ "Claimed" otherwise).

- Edit `src/components/admin/CompanyCommandPalette.tsx` to fetch claim codes alongside companies (uses existing `admin_list_claim_codes` RPC) and render the code + copy button on each row.
- No new pages, no new sidebar item. Codes appear exactly where you already look up companies.

### Option B — Add a dedicated "Claim Codes" entry in the admin sidebar
Add a new icon (KeyRound) to `AdminIconSidebar` that opens a panel showing all companies + codes, same content as `ClaimCodesPanel.tsx`.

- Edit `src/components/admin/AdminIconSidebar.tsx` (add nav item)
- Edit `src/components/admin/AdminContentTabs.tsx` (add `claim-codes` case → render `ClaimCodesPanel`)
- Default expanded so codes are visible immediately.

### Option C — Both
Show codes in Cmd-K results AND add the dedicated sidebar entry.

---

**Recommendation: Option A.** You already use Cmd-K to find companies, so the claim code shows up exactly when you need it (right after creating a company you want to hand off). Option B is fine if you prefer a checklist-style view of all unclaimed codes.

Tell me A, B, or C and I'll ship it.
