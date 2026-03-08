

# Fix Three Critical Bugs: Image Generation, Social Posting, PDF Generation

## Problems Identified

### 1. Image Generation — Stack Overflow on Large Images
**Root Cause**: In `gemini-client.ts` line 97, the code uses:
```javascript
btoa(String.fromCharCode(...new Uint8Array(imgBuffer)))
```
The spread operator `...` exceeds JavaScript's argument limit (~65K) for large images, causing `RangeError: Maximum call stack size exceeded`.

### 2. Social Media Posting — Wrong Endpoint for Facebook
**Root Cause**: In `boss-chat/index.ts` line 1288, when `publish_now` is true:
```javascript
const publishFn = args.target_platform === 'instagram' ? 'publish-meta-post' : 'publish-facebook-post';
```
This uses the old `publish-facebook-post` function which expects a completely different schema (`scheduled_post_id` + `facebook_scheduled_posts` table) than what boss-chat provides (`companyId`, `content`, `imageUrl`).

### 3. PDF Generation — Parameter Schema Mismatch
**Root Cause**: In `boss-chat/index.ts` lines 1527-1531, the call to `generate-document` sends:
```javascript
{ companyId, documentType, data, bossPhone }
```
But `generate-document/index.ts` line 56 expects:
```javascript
{ document_type, data, company_id, send_whatsapp }
```
The camelCase vs snake_case mismatch causes silent failures.

---

## Fixes

### Fix 1: Memory-Safe Base64 Conversion
**File**: `supabase/functions/_shared/gemini-client.ts`

Replace the problematic line 97 with a chunked approach that processes the buffer in safe batches:
```javascript
// Convert in chunks to avoid stack overflow on large images
const bytes = new Uint8Array(imgBuffer);
let imgBase64 = '';
const chunkSize = 32768;
for (let i = 0; i < bytes.length; i += chunkSize) {
  const chunk = bytes.subarray(i, i + chunkSize);
  imgBase64 += String.fromCharCode.apply(null, [...chunk]);
}
imgBase64 = btoa(imgBase64);
```

### Fix 2: Use Correct Publishing Endpoint
**File**: `supabase/functions/boss-chat/index.ts`

Line 1288: Always use `publish-meta-post` for immediate publishing:
```javascript
const publishFn = 'publish-meta-post';
```

And change the payload at line 1291-1293 to match what `publish-meta-post` expects (insert via scheduled_posts table, then publish):
- First insert a scheduled_posts row with status='approved'
- Then call publish-meta-post with the `post_id`

### Fix 3: Correct Parameter Naming
**File**: `supabase/functions/boss-chat/index.ts`

Lines 1527-1532: Change from camelCase to snake_case:
```javascript
body: JSON.stringify({
  company_id: company.id,
  document_type: args.document_type,
  data: args.data,
  send_whatsapp: true,
}),
```

---

## Deployment
- Redeploy `boss-chat`, `gemini-client.ts` (shared), and any functions importing it (like `whatsapp-image-gen`)

