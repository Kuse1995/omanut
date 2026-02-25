

# Demo Preparation Plan — Banking Industry Pitch

## Overview

Updated plan: instead of an Eco Bank-specific page, create a **generic banking industry pitch page** at `/pitch/banking` that positions Omanut as the AI solution for any bank. This makes the same page reusable for Eco Bank, Stanbic, FNB, or any financial institution demo.

## Changes

### 1. Create `/pitch/banking` page (`src/pages/PitchBanking.tsx`)

A clean, full-screen presentation page with no site navigation (no FloatingNav). Dark, enterprise-grade design. Sections:

- **Header**: Omanut logo + "AI Customer Service for Banking"
- **The Problem**: 3 pain points — (1) Call center queues costing millions yearly, (2) 70% of inquiries are repetitive Tier 1 (balance, card status, branch info), (3) Zero support outside business hours
- **The Solution**: WhatsApp AI that handles Tier 1 queries conversationally (not menu bots). Includes an embedded simulated banking chat showing: balance check → card block request → intelligent handoff with structured summary to agent
- **How It Works**: 3-step visual flow — Customer texts WhatsApp → AI resolves or routes → Structured handoff to human agent with full context
- **Key Metrics**: ROI projections (estimated 70% Tier 1 automation, 24/7 availability, seconds vs minutes response time)
- **Voice AI — Coming Soon**: Teaser section mentioning phone call handling is in development
- **CTA**: "See It Live" button linking to the demo WhatsApp number (or QR code)

### 2. Update hero chat demo (`src/components/landing/LiveChatDemo.tsx`)

Replace the restaurant reservation conversation with a banking scenario:

```
Customer: "Hi, I need to check my account balance"
AI: "Hello! I can help with that. For security, could you confirm the last 4 digits of your account number?"
Customer: "4521"  
AI: "Your current balance is K12,450.00. Would you like a mini-statement or help with anything else?"
```

### 3. Add "Live Demo" to navigation (`src/components/landing/FloatingNav.tsx`)

Add a "Live Demo" link between "Customers" and "Pricing" in both desktop and mobile menus, pointing to `/demo`.

### 4. Update client logos (`src/components/landing/ClientLogosCarousel.tsx`)

Replace placeholder names with enterprise-sounding companies across sectors: "Capital Finance Group", "Pan-African Logistics", "Continental Hotels", "Meridian Insurance", "Atlas Telecom", "Savanna Health", "Zenith Property", "Equator Energy".

### 5. Add financial services testimonial (`src/components/landing/TestimonialCards.tsx`)

Replace the school testimonial with a financial services one about reducing call center load and automating account inquiries.

### 6. Update feature descriptions (`src/components/landing/FeatureShowcase.tsx`)

Adjust the WhatsApp Integration description to mention "account inquiries, card services, and branch information" alongside existing capabilities.

### 7. Register route (`src/App.tsx`)

Add `/pitch/banking` route pointing to `PitchBanking`.

## Files

| Action | File |
|--------|------|
| Create | `src/pages/PitchBanking.tsx` |
| Edit | `src/App.tsx` — add route |
| Edit | `src/components/landing/LiveChatDemo.tsx` — banking conversation |
| Edit | `src/components/landing/FloatingNav.tsx` — add Live Demo link |
| Edit | `src/components/landing/ClientLogosCarousel.tsx` — enterprise logos |
| Edit | `src/components/landing/TestimonialCards.tsx` — financial testimonial |
| Edit | `src/components/landing/FeatureShowcase.tsx` — banking use cases |

