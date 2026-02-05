
# Plan: Add Media Library Tab to Admin Dashboard

## Problem
You have a fully functional media upload component (`CompanyMedia`) that allows uploading images and videos to be sent to clients, but it's **not accessible** from the admin dashboard. The component is hidden in a legacy Settings page that isn't easily reachable.

## Solution
Add a new "Media Library" tab to the admin dashboard navigation, making it easy to upload and manage media files that the AI can send to customers during conversations.

---

## Implementation Steps

### Step 1: Add Media Tab to Sidebar Navigation

**File:** `src/components/admin/AdminIconSidebar.tsx`

Add a new navigation item for the media library:

```text
Current nav items:
- Conversations
- Client Insights
- Reservations
- AI Control
- Image Generation
- Company Settings
- Billing & Credits
- Products & Payments

New item to add:
- Media Library (with Image icon)
```

The new item will be placed after "Image Generation" and before "Company Settings" since media is related to content management.

### Step 2: Create Media Library Panel Wrapper

**File:** `src/components/admin/MediaLibraryPanel.tsx` (new)

Create a wrapper component that:
- Uses the existing `CompanyMedia` component
- Adds admin dashboard styling consistency
- Shows a "Select a company" message when no company is selected
- Wraps content in a card with proper spacing

### Step 3: Add Media Tab Case to Content Tabs

**File:** `src/components/admin/AdminContentTabs.tsx`

Add the new `'media'` case to the switch statement that renders `<MediaLibraryPanel />`.

---

## Technical Details

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/admin/AdminIconSidebar.tsx` | Modify | Add `media` nav item with Image icon |
| `src/components/admin/MediaLibraryPanel.tsx` | Create | Wrapper for CompanyMedia with dashboard styling |
| `src/components/admin/AdminContentTabs.tsx` | Modify | Add case for `'media'` tab |

### UI Flow

```text
Admin Dashboard
    |
    +-- Sidebar
    |     +-- ... existing items ...
    |     +-- Media Library (NEW) <-- Image icon
    |     +-- ... existing items ...
    |
    +-- Content Area
          +-- case 'media':
                +-- MediaLibraryPanel
                      +-- Card header: "Media Library"
                      +-- Card description: "Upload and manage media to share with customers"
                      +-- CompanyMedia component (existing)
```

### Media Upload Features (Already Implemented)

The existing `CompanyMedia` component provides:
- **Multi-category uploads**: Products, Interior, Exterior, Logo, Promotional, Staff, Events, Facilities, Other
- **AI-powered analysis**: Automatically suggests category, description, and tags for images
- **Video support**: With automatic thumbnail generation
- **Large file handling**: Up to 150MB with video compression
- **Grid/list view**: For browsing uploaded media
- **Delete functionality**: Remove unwanted media

### How AI Uses This Media

The WhatsApp AI already knows how to use uploaded media:
1. Media is stored in `company_media` table with public URLs
2. AI system prompt includes the media library with URLs
3. AI can call `send_media` tool to deliver files to customers
4. URLs are validated to prevent hallucinated links

---

## Expected Result

After implementation:
1. Click "Media Library" in admin sidebar
2. See all uploaded media with category filters
3. Click "Upload" to add new images/videos
4. AI automatically suggests metadata for images
5. Uploaded media appears in AI's available library
6. AI can send this media to customers when requested

