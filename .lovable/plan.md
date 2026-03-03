

## Problem

When the AI Training Coach saves something, it calls `onDataChanged` → `fetchData()` in `AITrainingEditor`. This sets `isLoading(true)` on line 39, which causes the entire component tree (including `AITrainingCoach`) to unmount via the loading guard on line 112-118. When loading finishes, `AITrainingCoach` remounts fresh with empty state, losing the entire conversation.

## Fix

**File: `src/components/admin/AITrainingEditor.tsx`**

1. Remove the full-page loading spinner that unmounts everything. Instead, only show the spinner on initial load (first mount), and for subsequent refreshes, update data silently in the background without touching `isLoading`.

2. Split `fetchData` into two modes:
   - **Initial load**: shows spinner, used on mount
   - **Background refresh**: updates `quickReferenceInfo` and `documents` state without setting `isLoading`, so the Coach stays mounted

Concretely: add a `isInitialLoad` ref. On first call, show spinner. On `onDataChanged` callbacks, just re-fetch the knowledge base text and documents without flipping `isLoading`.

**File: `src/components/admin/AITrainingCoach.tsx`**

No changes needed — the component already manages its own state correctly. The fix is entirely in the parent preventing unmount.

| Action | File |
|---|---|
| Edit | `src/components/admin/AITrainingEditor.tsx` |

