// Industry presets — lifted from CompanyForm.tsx so picking a type prefills sensible defaults.
export interface IndustryPreset {
  voice_style: string;
  hours: string;
  services: string;
  branches: string;
  service_locations: string;
  currency_prefix: string;
}

export const INDUSTRY_PRESETS: Record<string, IndustryPreset> = {
  restaurant: {
    voice_style: "Warm, polite receptionist. Friendly and helpful with recommendations.",
    hours: "Mon-Sun 10:00 – 23:00",
    services: "Grilled fish, steaks, pasta, salads, desserts",
    branches: "Main",
    service_locations: "outdoor,indoor,bar,VIP",
    currency_prefix: "K",
  },
  clinic: {
    voice_style: "Professional, empathetic receptionist. Calm and reassuring.",
    hours: "Mon-Fri 08:00 – 17:00, Sat 09:00 – 13:00",
    services: "General consultation, specialist appointments, laboratory services, X-rays",
    branches: "Main",
    service_locations: "general,priority,pediatrics,specialist wing",
    currency_prefix: "K",
  },
  retail: {
    voice_style: "Friendly, knowledgeable shop assistant. Helpful with product recommendations.",
    hours: "Mon-Sat 09:00 – 19:00",
    services: "List your top product categories",
    branches: "Main",
    service_locations: "in-store,online,delivery",
    currency_prefix: "K",
  },
  salon: {
    voice_style: "Friendly, professional receptionist. Knowledgeable and helpful.",
    hours: "Mon-Sat 09:00 – 19:00",
    services: "Haircuts, coloring, styling, manicures, pedicures, facials",
    branches: "Main",
    service_locations: "main salon,VIP room,spa area",
    currency_prefix: "K",
  },
  hotel: {
    voice_style: "Warm, professional receptionist. Helpful and accommodating.",
    hours: "24/7",
    services: "Room booking, restaurant, spa, pool, gym, conference rooms",
    branches: "Main",
    service_locations: "poolside,restaurant,spa,conference,rooms",
    currency_prefix: "K",
  },
  school: {
    voice_style: "Polite, professional administrator. Clear and informative.",
    hours: "Mon-Fri 07:30 – 16:30",
    services: "Admissions, course information, fee enquiries, parent support",
    branches: "Main campus",
    service_locations: "main office,admissions,bursary",
    currency_prefix: "K",
  },
  other: {
    voice_style: "Friendly, professional. Clear and helpful.",
    hours: "Mon-Fri 09:00 – 17:00",
    services: "",
    branches: "Main",
    service_locations: "",
    currency_prefix: "K",
  },
};

export const BUSINESS_TYPES = [
  { value: "restaurant", label: "Restaurant" },
  { value: "clinic", label: "Clinic" },
  { value: "retail", label: "Retail Shop" },
  { value: "salon", label: "Salon / Spa" },
  { value: "hotel", label: "Hotel / Lodge" },
  { value: "school", label: "School" },
  { value: "other", label: "Something else" },
];

export const HOURS_PRESETS = [
  "24/7",
  "Mon-Fri 09:00 – 17:00",
  "Mon-Sat 09:00 – 19:00",
  "Mon-Sun 10:00 – 23:00",
];

export const CURRENCIES = [
  { value: "K", label: "K — Kwacha" },
  { value: "$", label: "$ — US Dollar" },
  { value: "R", label: "R — Rand" },
  { value: "KSh", label: "KSh — Shilling" },
];

export const VOICE_TONES = [
  { value: "Warm, friendly, conversational. Uses customer name where possible.", label: "Warm" },
  { value: "Professional, concise, polite. Sticks to facts.", label: "Professional" },
  { value: "Playful, upbeat, uses light humor where appropriate.", label: "Playful" },
  { value: "Direct, efficient, no fluff. Answers fast.", label: "Direct" },
];

export const REQUIRED_PROFILE_FIELDS = [
  "name",
  "business_type",
  "services",
  "hours",
  "currency_prefix",
  "voice_style",
] as const;

export interface WizardDraft {
  name: string;
  business_type: string;
  services: string;
  hours: string;
  branches: string;
  currency_prefix: string;
  voice_style: string;
  quick_reference_info: string;
  boss_phone: string;
  boss_role: "owner" | "manager" | "accountant";
}

export const EMPTY_DRAFT: WizardDraft = {
  name: "",
  business_type: "",
  services: "",
  hours: "",
  branches: "Main",
  currency_prefix: "K",
  voice_style: "",
  quick_reference_info: "",
  boss_phone: "",
  boss_role: "owner",
};
