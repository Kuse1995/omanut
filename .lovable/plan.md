

## Plan: Unify Meta Credentials — Add IG Business ID to Existing Facebook Config

### Problem
Currently, the form forces choosing either "facebook" or "instagram" as the platform and requires a separate credential entry for each. Since the IG Professional account shares the same Page Access Token as the linked Facebook Page, this creates duplication and confusion.

### Solution
Remove the platform selector. Each credential represents a **Facebook Page** (with its Page ID and Access Token). Add an optional **Instagram Business Account ID** field to the same form. If filled, the system knows this page also has Instagram enabled and uses the same token for IG API calls.

### Changes

**UI: `src/components/admin/MetaIntegrationsPanel.tsx`**
- Remove the `platform` select dropdown entirely
- Add an optional `ig_user_id` text input: "Instagram Business Account ID (optional)"
- Add helper text: "If your Instagram Professional account is linked to this Facebook Page, paste the IG Business Account ID here to enable Instagram publishing with the same token"
- Update the form state to include `ig_user_id` instead of `platform`
- On save, set `platform: 'facebook'` as default (it's always a FB page credential)
- In the credential list cards, show both Facebook icon + Instagram badge if `ig_user_id` is present
- Update the interface to include `ig_user_id`

**Edge functions** — no changes needed. The `meta-webhook` and `schedule-meta-post` already look up `ig_user_id` from `meta_credentials` and use the same `access_token`.

### Files Changed

| File | Change |
|------|--------|
| `src/components/admin/MetaIntegrationsPanel.tsx` | Remove platform selector, add `ig_user_id` field, show IG badge when present |

