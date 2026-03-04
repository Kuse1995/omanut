

## Plan: Add Image Support to Content Scheduler

### Database
Add `image_url text` column to `scheduled_posts`:
```sql
ALTER TABLE public.scheduled_posts ADD COLUMN image_url text;
```

### Edge Function (`schedule-meta-post/index.ts`)
Add a branch after loading the post and building the Unix timestamp:
- **No image**: Keep existing `POST /{page_id}/feed` with `{ message, published: false, scheduled_publish_time }`
- **Has image** (`post.image_url`): `POST /{page_id}/photos` with `{ url: post.image_url, caption: post.content, published: false, scheduled_publish_time }`

### Frontend (`ContentSchedulerPanel.tsx`)
Add two ways to attach an image:

1. **Pick from generated images** -- query `generated_images` table (status = 'approved') for the company, show a scrollable row of thumbnails to select from
2. **Upload a new image** -- file input that uploads to `company-media` bucket (path: `scheduled-posts/{company_id}/{uuid}.ext`), gets public URL

UI additions:
- New state: `imageUrl`, `showImagePicker`
- "Attach Image" button with `ImagePlus` icon below the text area
- When clicked, show a popover/section with two tabs: "Generated Images" and "Upload"
- Selected image shows as a thumbnail preview with an "X" to remove
- Pass `image_url` in the `scheduled_posts` insert
- Show image thumbnails in the scheduled posts list
- Clear image state on success

### Files Changed

| File | Change |
|------|--------|
| Migration SQL | Add `image_url text` to `scheduled_posts` |
| `supabase/functions/schedule-meta-post/index.ts` | Branch: `/photos` endpoint when `image_url` present |
| `src/components/admin/ContentSchedulerPanel.tsx` | Image picker UI, upload, preview, pass `image_url` to DB |

