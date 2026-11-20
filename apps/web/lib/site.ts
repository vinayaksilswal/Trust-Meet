// Public, build-time site settings. Every value here ends up in the browser bundle,
// so never put secrets in NEXT_PUBLIC_ variables.

function publicUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.hostname === "localhost" ? url.origin : null;
  } catch {
    return null;
  }
}

const fallback = (value: string | undefined, placeholder: string) => value?.trim() || placeholder;

export const site = {
  name: "Trust Meet",
  tagline: "Real People. Real Conversations.",
  description: "Meet adults over random video, voice or text chat. Free to start, built in India with safety tools in every call.",
  url: publicUrl(process.env.NEXT_PUBLIC_SITE_URL),
  // Search indexing stays off until the production domain is ready to be crawled.
  indexable: process.env.NEXT_PUBLIC_SITE_INDEXABLE === "true" && !!publicUrl(process.env.NEXT_PUBLIC_SITE_URL),
  adsenseClient: /^ca-pub-\d{10,20}$/.test(process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "") ? process.env.NEXT_PUBLIC_ADSENSE_CLIENT! : null,
  adsenseSlot: /^\d{6,16}$/.test(process.env.NEXT_PUBLIC_ADSENSE_SLOT ?? "") ? process.env.NEXT_PUBLIC_ADSENSE_SLOT! : null,
  plusPrice: Number.parseInt(process.env.NEXT_PUBLIC_PLUS_PRICE_INR ?? "199", 10) || 199,
  // Legal operator details appear in the Terms, Contact and Grievance pages and are
  // required for Razorpay activation and the IT Rules, 2021. Replace every placeholder.
  operator: {
    legalName: fallback(process.env.NEXT_PUBLIC_OPERATOR_NAME, "[Registered business name]"),
    address: fallback(process.env.NEXT_PUBLIC_OPERATOR_ADDRESS, "[Registered business address, India]"),
    supportEmail: fallback(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, "[support email]"),
    phone: fallback(process.env.NEXT_PUBLIC_SUPPORT_PHONE, "[support phone]"),
    grievanceOfficer: fallback(process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER, "[Grievance Officer name]"),
    grievanceEmail: fallback(process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL, "[grievance email]"),
    jurisdiction: fallback(process.env.NEXT_PUBLIC_JURISDICTION, "[city], India"),
  },
  updated: "20 November 2026",
};
