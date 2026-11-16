# Test report

Verified on 16 November 2026 using native Windows services on loopback.

| Check | Result |
| --- | --- |
| Pytest API integration | 8 passed against the live API, PostgreSQL, Redis, Mailpit and LiveKit control API |
| Playwright Chromium | 6 passed with isolated browser contexts and actual local LiveKit |
| Next.js | Route type generation, TypeScript and optimized production build passed |
| PostgreSQL migrations | Upgrade from base, downgrade to base, re-upgrade and Alembic schema check passed on a disposable database |
| Dependency checks | npm audit reported zero vulnerabilities and pip check reported no broken requirements |
| Docker Compose | Configuration parsed and pinned service image tags resolved in their registries |

API tests cover CSRF, verification and token reuse, password recovery, session revocation, underage exclusion, production feature gates, matchmaking filters and duplicate requests, both-participant consent, blocks, room permissions, start-time restrictions and concurrent capacity enforcement.

Browser tests cover responsive navigation and automated discovery accessibility checks, authenticated two-user text exchange, received voice and video, local preview, refresh recovery, mutual match consent, Next, and a three-participant room with password entry, approval, chat, mute, removal and close. Chromium used synthetic microphone and camera input. LiveKit transported actual tracks and data.

A Docker engine was unavailable on this machine. Container startup, GitHub Actions execution, real hardware, TURN fallback, LiveKit Cloud token revocation, production security and load remain unverified.

## Trust Meet LAN test

The Windows LAN launch served HTTPS and same-origin LiveKit signaling at the host's private Wi-Fi address. Nine API tests and six Chromium tests passed through the LAN address, including secure cookies, two-user text, audio and video, refresh recovery and a three-user private video room. The automated clients ran on the host with synthetic media. A second physical device still needs a manual Wi-Fi and camera test.

The Random Connect redesign and queue fix passed all eight Chromium tests through the LAN gateway. The tests cover stale-search replacement after a tab switch and reload, desktop tile placement, mobile accessibility checks, and local camera preview with track release. LiveKit text, audio, two-user video, and the private video room passed on the same build.

## Hosted beta preparation

The Vercel-mode Next.js build, migration 0004 and the local schema check passed. Hosted configuration and authorization checks passed, along with the same-origin proxy test for session headers, backend authentication, route restrictions and body limits. The Cloud revocation sequencing test uses a simulated provider. Run the deployment guide's live smoke checks with the hosted database, email sender, LiveKit Cloud and two real devices before enabling beta traffic.

## Public signup and Vercel Services

Migration 0005, eligibility and hosted proxy tests, and the Vercel configuration schema check passed. The browser suite passed across the full run and a targeted rerun of the new permission test. The permission test checks denied access, waits for mutual consent, and receives synthetic video and audio on both sides.

Vercel CLI detected both services during `vercel dev --local`. Windows denied a symlink while the CLI installed its builders, so the local Vercel service runtime and the hosted provider integrations remain unverified.
