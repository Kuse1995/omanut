

# Add Data Deletion Page + Update Privacy Policy & Terms Plan

Extending the previously approved plan to include a Data Deletion Instructions page — required by Meta App Review.

## Changes

### New Files
| File | Description |
|------|-------------|
| `src/pages/PrivacyPolicy.tsx` | Full privacy policy (Meta-compliant) |
| `src/pages/TermsOfService.tsx` | Full terms of service |
| `src/pages/DataDeletion.tsx` | Data deletion instructions page — explains how users request deletion, what data is deleted, timeline, and contact info. Includes a simple deletion request form (email + description) |

### Modified Files
| File | Change |
|------|--------|
| `src/App.tsx` | Add routes: `/privacy`, `/terms`, `/data-deletion` |
| `src/components/landing/Footer.tsx` | Update Privacy Policy, Terms links; add Data Deletion link under Legal section |

### Data Deletion Page Content
- What data we store (messages, profile info from Meta platforms)
- How to request deletion (email or in-page form)
- What happens after a request (confirmation, 30-day processing)
- Automatic deletion via Meta's data deletion callback URL
- Contact email for requests

### Meta App Review URLs
After deployment:
- Privacy Policy: `https://omanut.lovable.app/privacy`
- Terms of Service: `https://omanut.lovable.app/terms`
- Data Deletion: `https://omanut.lovable.app/data-deletion`

