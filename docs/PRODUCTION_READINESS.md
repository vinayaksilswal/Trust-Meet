# Production readiness

The hosted configuration supports password signup and a self-reported date-of-birth check on Vercel, with an internal API, a maintenance daemon and a managed media provider. Conversation flags default to off. The hosted stack and provider enforcement need live verification with production credentials.

## Implemented for local development

- Password registration, password recovery, logout, and server-side session revocation.
- Adult eligibility interface with an explicit local test provider.
- Authenticated direct invitations and Redis-backed Random Connect with consent, queue leases, preferences, Next, blocks and reports.
- LiveKit text, voice and video with browser media controls.
- Private rooms with expiring links, passwords, host approval, schedule, capacity, lock, mute, removal and closure.
- PostgreSQL migrations, development infrastructure and a CI workflow.

## Partial

- TrustOS stores categorized conversation and room reports and blocks. The operator CLI records account suspensions and lists reports. Staffed case handling, appeal tooling and escalation remain open.
- Conversation timestamps support duration tracking. Billing-grade usage metering, live occupancy and cost controls are pending.
- Hosted eligibility uses the result of a self-reported date-of-birth check. Live media-provider checks remain open. Self-hosted development tokens can replay within their validity window.
- Discovery includes gated entries for business, wellness, fitness and astrology. Expert onboarding, appointments, Razorpay test settlement and public access to these modules are pending.

## Blocked pending authorization and operational reviews

- Public launch, production deployment, real payments and payouts.
- Wellness safeguarding, health workflow approval, and India-specific legal review.
- Production video testing needs working media credentials, effective media revocation and staffed moderation for public traffic.

## Unverified

- AWS infrastructure, production CI/CD, disaster recovery, restore drills and 99.9% availability.
- TURN fallback, LiveKit Cloud revocation, real-device coverage, cross-network performance and load capacity.
- Full accessibility audit, ASVS Level 2 assessment, container scanning, and legal and privacy compliance.
