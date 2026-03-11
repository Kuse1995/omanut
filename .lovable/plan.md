

# Product Identity Profiles — Per-Company Visual Fingerprinting

## Problem
Cross-company product contamination: LifeStraw products appear in E Library images, and Finch keeps generating LifeStraw Community even for other products. The multimodal product matcher sometimes selects wrong products, and the prompt pipeline has no company-scoped exclusion mechanism.

## Solution
A **Product Identity Profile** system that stores structured visual fingerprints per product per company, injected as hard constraints into the generation pipeline. Plus an exclusion list and a polished admin UI for managing profiles.

---

## Database Changes

**New table: `product_identity_profiles`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid NOT NULL | FK to companies |
| media_id | uuid | FK to company_media (nullable for manual entries) |
| product_name | text NOT NULL | e.g. "LifeStraw Community" |
| visual_fingerprint | jsonb | `{ colors: ["#hex"], labels: ["text"], shape: "cylinder", distinguishing_features: [...] }` |
| exclusion_keywords | text[] | Brand names / product names that must NEVER appear |
| description | text | Plain text description |
| is_active | boolean DEFAULT true | |
| created_at, updated_at | timestamptz | |

RLS: company access via `user_has_company_access(company_id)` + admin full access. System insert for edge functions.

---

## Edge Function: `extract-product-identity` (new)

Takes a product image URL + company context, uses Gemini Vision to extract:
- Exact colors (hex codes)
- Label text (verbatim)
- Packaging shape/form factor
- Logo placement description
- Distinguishing features

Returns structured JSON saved to `product_identity_profiles`.

---

## Pipeline Integration (`whatsapp-image-gen/index.ts`)

1. **In `selectProductImageForPrompt`**: After matching a product, load its `product_identity_profiles` entry. If it has a visual fingerprint, inject it into the selection prompt so the AI knows exactly what the product looks like.

2. **In `promptOptimizerAgent`**: Add a new section to the system prompt:
   ```
   PRODUCT IDENTITY LOCK:
   - Name: "LifeStraw Community"
   - Colors: #00A651 (green cap), #FFFFFF (body)
   - Labels: "LifeStraw Community" text, blue wave logo
   - Shape: Large cylindrical container with spigot
   - NEVER INCLUDE: [exclusion list from company profiles]
   ```

3. **In `supervisorReviewAgent`**: Add exclusion check — reject if prompt contains any term from any OTHER company's exclusion list that shares this platform.

4. **Company-level exclusion**: Load ALL profiles for the company and build a global exclusion string: "NEVER generate images containing: [list]".

---

## Admin UI: Product Identity Manager

New tab "Products" in the ImageGenerationPanel tabs (Gallery | Feedback | Settings → Gallery | Products | Feedback | Settings).

### Design (Linear aesthetic)

**Product card grid** — each card shows:
- Product image thumbnail (from company_media)
- Product name
- Color swatches (rendered from hex codes)
- Status badge (active/inactive)
- Click to expand/edit

**Profile detail panel** (dialog):
- Large product image preview
- Extracted visual fingerprint displayed as structured chips/badges
- Color palette with hex-code swatches
- Label text list
- Shape descriptor
- Exclusion keywords (editable tag input)
- "Re-analyze" button to re-extract fingerprint
- Toggle active/inactive

**Empty state**: "No product profiles yet. Select product images from your Brand Assets to create identity profiles." with a CTA.

**Auto-profile flow**: When uploading a new product image in Brand Asset Library, offer to auto-create a product identity profile.

### Components

1. `src/components/admin/ProductIdentityManager.tsx` — main tab content with grid + dialog
2. Modifications to `ImageGenerationPanel.tsx` — add "Products" tab

---

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create `product_identity_profiles` table + RLS |
| `supabase/functions/extract-product-identity/index.ts` | New edge function |
| `src/components/admin/ProductIdentityManager.tsx` | New UI component |
| `src/components/admin/ImageGenerationPanel.tsx` | Add Products tab |
| `supabase/functions/whatsapp-image-gen/index.ts` | Inject profiles into pipeline agents |

