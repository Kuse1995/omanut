I found the current Facebook Connect failure shown in your screenshot:

`Expression is of type asyncfunction, not function`

This is a known Facebook JavaScript SDK limitation: `FB.login` rejects an `async` callback directly. Our current code passes `async (resp) => { ... }`, so the popup fails before login can continue.

Plan:

1. Fix the Facebook Connect button
   - Change the `FB.login` callback in `MetaIntegrationsPanel.tsx` from an async function to a plain `function(resp) { ... }`.
   - Move the existing async exchange logic into a separate helper/inner promise so Facebook receives a normal callback.
   - Keep the timeout, loading reset, and clear error handling already added.
   - Update the visible error copy so this specific SDK bug no longer gets mislabeled as popup/ad-blocker failure.

2. Add a safer fallback path if Facebook popup still fails
   - Keep the manual WhatsApp Cloud credential card as the non-breaking path.
   - Add clearer instructions near the error panel: if popup login is blocked, the user can still use manual WABA ID / Phone Number ID setup without disturbing Twilio clients.

3. Finish the remaining WhatsApp Cloud provider gap
   - Refactor the internal sends inside `whatsapp-messages` that still call Twilio directly.
   - Route those sends through the existing `send-whatsapp-message` gateway so each company uses its selected provider:
     - `twilio` remains unchanged for existing clients.
     - `meta_cloud` sends through the new direct Meta WhatsApp Cloud function.
   - This covers boss handoff fan-out and multi-media/image dispatch paths that were previously documented as the known gap.

4. Validate the implementation
   - Run a type/build check after edits.
   - Deploy the changed backend functions if needed.
   - Confirm that the code no longer passes async callbacks to `FB.login`.

Technical notes:
- No database migration should be needed for this fix because the provider toggle tables/columns already exist.
- I will not edit the auto-generated backend client/types files.
- Twilio stays the default provider, so current customers remain protected while Meta Cloud can be enabled company-by-company.