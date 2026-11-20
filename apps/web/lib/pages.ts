import { site } from "./site";

// Template policy text. Have a lawyer qualified in Indian law review it before launch.
export type Block = { heading?: string; body?: string[]; list?: string[] };
export type InfoPage = { title: string; summary: string; legal?: boolean; blocks: Block[] };

const o = site.operator;
const price = `₹${site.plusPrice}`;

export const pages: Record<string, InfoPage> = {
  about: {
    title: "About Trust Meet",
    summary: "An India-first place to meet new people over video, voice or text, built for adults and designed around safety.",
    blocks: [
      { body: [
        "Trust Meet pairs you with another adult for a one-to-one conversation. Choose video, voice or text, and move on with Next whenever you like.",
        "Every account completes an 18+ date-of-birth check before it can join a call. Calls start only when both people accept, and anyone can leave, block or report at any time.",
      ] },
      { heading: "What you can do", list: [
        "Random Connect: meet someone new instantly, filtered by language and shared interests.",
        "Private Rooms: invite friends or a community into a scheduled room with host controls.",
        "Trust Meet Plus: an ad-free experience that supports the people who keep the platform safe.",
      ] },
    ],
  },
  safety: {
    title: "Safety Center",
    summary: "The tools and rules that keep conversations respectful, and what to do when they are not.",
    blocks: [
      { heading: "Before you connect", list: [
        "Trust Meet is for adults aged 18 and over. Accounts that appear to belong to a minor are removed.",
        "Your camera and microphone stay off until you and your match both accept the conversation.",
        "Never share your phone number, address, financial details or passwords with someone you just met.",
      ] },
      { heading: "During a conversation", list: [
        "Select Next or Leave to end a conversation instantly.",
        "Select Block so that person can never be matched with you again.",
        "Select Report to flag harassment, nudity, threats, scams, hate or suspected underage users. Reports go to our moderation queue.",
      ] },
      { heading: "If someone is in danger", body: [
        "If you believe someone is at immediate risk, call 112 (India emergency services). Report online child sexual abuse material or cybercrime at cybercrime.gov.in or by calling 1930.",
        `You can also contact our Grievance Officer at ${o.grievanceEmail}.`,
      ] },
    ],
  },
  guidelines: {
    title: "Community Guidelines",
    summary: "Simple rules everyone agrees to before joining a conversation. Breaking them leads to suspension.",
    blocks: [
      { heading: "Not allowed", list: [
        "Anyone under 18, or helping a minor access the service.",
        "Nudity, sexual acts or sexually explicit content on camera or in chat.",
        "Harassment, bullying, threats, hate speech or discrimination.",
        "Spam, advertising, scams, phishing or requests for money.",
        "Recording, screenshotting or sharing another person without their consent.",
        "Impersonation, illegal activity, self-harm promotion or graphic violence.",
      ] },
      { heading: "Enforcement", body: [
        "We review reports and may warn, suspend or permanently ban accounts. We remove unlawful content and preserve and report it to authorities where Indian law requires, including under the Protection of Children from Sexual Offences Act, 2012.",
        `If you think we made a mistake, write to ${o.grievanceEmail} with your account email and we will review the decision.`,
      ] },
    ],
  },
  terms: {
    title: "Terms of Service", legal: true,
    summary: `These terms form an agreement between you and ${o.legalName} for use of Trust Meet.`,
    blocks: [
      { heading: "1. Eligibility", body: ["You must be at least 18 years old and legally able to enter a contract in India. You must give accurate information, including your date of birth, and keep your password secure."] },
      { heading: "2. Your conduct", body: ["You agree to follow the Community Guidelines. You are responsible for what you say and show during conversations. We may suspend or end accounts that break these terms or the law."] },
      { heading: "3. The service", body: ["Trust Meet connects you with other users we do not control. We do not record calls or store chat history. We do not guarantee that a match will be available or that any user is who they claim to be. Features may change and the service may be interrupted for maintenance."] },
      { heading: "4. Trust Meet Plus", body: [`Plus is a monthly subscription currently priced at ${price} per month, including applicable taxes, billed through Razorpay. It renews automatically until you cancel. Cancellation takes effect at the end of the current billing period. Refunds follow the Refund and Cancellation Policy.`] },
      { heading: "5. Advertising", body: ["The free service may show advertising from Google and other partners outside of calls. Plus members do not see ads."] },
      { heading: "6. Liability", body: ["To the extent permitted by law, the service is provided as is and our total liability for any claim is limited to the amount you paid us in the three months before the claim. Nothing in these terms limits liability that cannot be limited under Indian law."] },
      { heading: "7. Governing law", body: [`These terms are governed by the laws of India. Courts at ${o.jurisdiction} have exclusive jurisdiction.`] },
      { heading: "8. Contact", body: [`${o.legalName}, ${o.address}. Email ${o.supportEmail}.`] },
    ],
  },
  privacy: {
    title: "Privacy Policy", legal: true,
    summary: "What we collect, why, and the choices you have, in line with the Digital Personal Data Protection Act, 2023.",
    blocks: [
      { heading: "What we collect", list: [
        "Account details: email, display name and a salted password hash.",
        "Age check: the 18+ result. We do not keep your date of birth.",
        "Conversation metadata: start and end times, blocks and reports. We do not record audio or video and do not store chat messages.",
        "Subscription records from Razorpay: plan, status and renewal date. Card and UPI details stay with Razorpay.",
        "Technical data: IP address and device information used for security and abuse prevention.",
      ] },
      { heading: "How we use it", body: ["To run your account, match you with other users, prevent abuse, handle reports, process subscriptions, and meet legal obligations."] },
      { heading: "Who we share it with", list: [
        "Media providers (LiveKit or Cloudflare) that carry live audio, video and messages between participants.",
        "Razorpay for payments and Resend for account emails.",
        "Google AdSense, on pages outside calls for free users. Google may use cookies to serve ads; you can choose non-personalised ads in our cookie banner and manage Google ad settings at adssettings.google.com.",
        "Law enforcement when required by Indian law.",
      ] },
      { heading: "Your rights", body: [`You can access, correct or erase your personal data and withdraw consent by writing to ${o.grievanceEmail}. We respond within the time required by law. You may also complain to the Data Protection Board of India.`] },
      { heading: "Retention", body: ["We keep account data while your account is active, safety records for as long as needed to investigate abuse and comply with law, and payment records for the period tax law requires."] },
    ],
  },
  refunds: {
    title: "Refund and Cancellation Policy", legal: true,
    summary: "How to cancel Trust Meet Plus and when you are eligible for a refund.",
    blocks: [
      { heading: "Cancellation", body: ["Cancel at any time from your Account page. You keep Plus until the end of the period you have paid for and are not charged again."] },
      { heading: "Refunds", list: [
        "If you were charged in error or charged twice, we refund the full amount.",
        "If you request a refund within 7 days of your first Plus payment, we refund it once per account.",
        "Renewal payments are not refundable after the billing period starts, except where the law requires.",
        "Approved refunds return to the original payment method through Razorpay within 5 to 7 working days.",
      ] },
      { heading: "Delivery", body: ["Plus is a digital service with no physical shipping. It activates on your account as soon as Razorpay confirms the payment."] },
      { heading: "How to ask", body: [`Email ${o.supportEmail} from your account email with the Razorpay payment ID.`] },
    ],
  },
  contact: {
    title: "Contact and Grievance Officer", legal: true,
    summary: "Reach our support team or the Grievance Officer appointed under the IT Rules, 2021.",
    blocks: [
      { heading: "Support", list: [`Email: ${o.supportEmail}`, `Phone: ${o.phone}`, `Address: ${o.legalName}, ${o.address}`] },
      { heading: "Grievance Officer", list: [`Name: ${o.grievanceOfficer}`, `Email: ${o.grievanceEmail}`, `Address: ${o.address}`], body: [
        "We acknowledge complaints within 24 hours and resolve them within 15 days. Complaints about content that exposes a person's private area, shows them in a sexual act, or impersonates them are acted on within 24 hours.",
      ] },
    ],
  },
};

export const closedModules = {
  wellness: "Mental Wellness", business: "Business Connect", fitness: "Fitness & Health", astrology: "Astrology Connect",
} as const;

export const legalLinks = [
  { href: "/terms", label: "Terms" }, { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" }, { href: "/guidelines", label: "Guidelines" },
  { href: "/contact", label: "Contact" },
];
