# Production readiness

The hosted configuration supports an invite-only adult beta on Vercel, a persistent API host, and LiveKit Cloud. Conversation flags default to off. The hosted stack and provider enforcement have not been tested against live production credentials.

## Implemented for local development

- Verified account registration, password recovery, logout, and server-side session revocation.
- Adult eligibility interface with an explicit local test provider.
- Authenticated direct invitations and Redis-backed Random Connect with consent, queue leases, preferences, Next, blocks and reports.
- LiveKit text, voice and video with browser media controls.
- Private rooms with expiring links, passwords, host approval, schedule, capacity, lock, mute, removal and closure.
- PostgreSQL migrations, development infrastructure and a CI workflow.

## Partial

- TrustOS stores categorized conversation and room reports and blocks. The hosted operator CLI records admission and suspension and lists reports. Staffed case handling, appeal tooling and escalation remain open.
- Conversation timestamps support duration tracking. Billing-grade usage metering, live occupancy and cost controls are pending.
- Hosted beta eligibility uses an operator-reviewed adult roster and mandatory email verification. Provider configuration and hosted revocation checks remain required. Self-hosted development tokens can replay within their validity window.
- Discovery includes gated entries for business, wellness, fitness and astrology. Expert onboarding, appointments, Razorpay test settlement and public access to these modules are pending.

## Blocked pending authorization and operational reviews

- Public launch, production deployment, real payments and payouts.
- Wellness safeguarding, health workflow approval, and India-specific legal review.
- Production registration and random video launch gates require approved age assurance, effective media revocation and staffed moderation.

## Unverified

- AWS infrastructure, production CI/CD, disaster recovery, restore drills and 99.9% availability.
- TURN fallback, LiveKit Cloud revocation, real-device coverage, cross-network performance and load capacity.
- Full accessibility audit, ASVS Level 2 assessment, container scanning, and legal and privacy compliance.
