

## Update META_VERIFY_TOKEN Secret

**What**: Prompt you to enter a new value for the `META_VERIFY_TOKEN` secret, which is used by the `meta-webhook` edge function to verify Facebook's webhook subscription handshake.

**How**: Use the `add_secret` tool to request a new value from you. This will present an input field where you can securely type the new token. Once saved, the edge function will immediately use the new value for any future verification requests from Meta.

**Important**: After updating the token, you'll also need to update the same value in the Meta Developer Portal's webhook configuration so they match.

