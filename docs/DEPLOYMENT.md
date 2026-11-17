# Deploy Trust Meet on Vercel

The repository root defines one Vercel project with two HTTP services and a background daemon. Import the entire repository and leave **Root Directory** at the repository root.

- `web` serves all public paths, including the same-origin `/api/*` routes. Its server-side handler forwards approved API paths, session cookies and the browser origin.
- `api` is the internal FastAPI service. `web` calls it through Vercel's `TRUST_MEET_API_URL` binding. Vercel injects the URL at runtime.
- `maintenance` runs one worker in Mumbai (`bom1`) for expired calls, room closure and media-token revocation. It uses PostgreSQL, Redis and LiveKit Cloud directly, with no public route. Vercel runs daemons only on production deployments during the beta period.

[Vercel Services](https://vercel.com/docs/services) · [Service bindings](https://vercel.com/docs/services/bindings) · [Vercel Daemons](https://vercel.com/docs/daemons)

## Providers and migration

1. Provision TLS-enabled PostgreSQL and Redis near the deployment. Use a managed PostgreSQL pooler sized for serverless traffic. Provision a dedicated LiveKit Cloud project, a verified Resend sender and a Veriff **Identity Verification** integration that returns the document-verified birth date and the supplied vendor data. Use separate resources for staging and production.
2. Configure the deployment variables in [the hosted environment example](../.env.hosted.example). Set `WEB_ORIGIN` to the exact public HTTPS domain without a trailing slash. Generate one high-entropy secret and use it for both `WEB_PROXY_SECRET` and `TRUST_MEET_WEB_PROXY_SECRET`. Scope each secret to the services that consume it if your project supports per-service variables. The worker uses the same production flags, database, Redis and provider configuration for expiry and revocation. Avoid setting `TRUST_MEET_API_URL` manually.
3. Set `RESEND_API_KEY` to a key with sending access and `SMTP_SENDER` to an address on a verified sending domain. Existing Resend SMTP configurations can supply the same API key through `SMTP_PASSWORD` when `SMTP_HOST=smtp.resend.com` and `SMTP_USERNAME=resend`.
4. Apply Alembic migrations before deploying the application. From the repository root, with the target environment exported, run `python -m alembic -c services/api/alembic.ini upgrade head`. Avoid reusing the LAN database because it contains local test identities and media records.
5. Start with the three `ENABLE_*` conversation flags off. Set `PUBLIC_CONVERSATIONS=true` once a production Veriff integration is configured. Public signup requires verified email. All eligible adults can use the features after passing online age verification. Existing local self-attested ages and old invite-roster entries do not grant production eligibility.

[Resend SMTP](https://resend.com/changelog/smtp-service) · [LiveKit Cloud connection setup](https://docs.livekit.io/intro/basics/connect/) · [Veriff sessions](https://devdocs.veriff.com/apidocs/v1sessions)

## Cloudflare RealtimeKit

1. Create an account at [Cloudflare](https://dash.cloudflare.com/sign-up) and create a RealtimeKit app in the dashboard. Use a separate app for staging. Copy the Cloudflare account ID and the RealtimeKit app ID. Create a custom API token with the account-level **Realtime Admin** permission scoped to that account. See the [RealtimeKit quickstart](https://developers.cloudflare.com/realtime/realtimekit/quickstart/).
2. In the RealtimeKit app, create `trust_meet_video` (video and audio), `trust_meet_audio` (voice and no camera), and `trust_meet_text` (no camera or microphone). Enable automatic admission in Cloudflare so Trust Meet's own admission rules apply. Use participant presets without moderation, screen sharing, recording, transcription, or connected-meeting privileges. See [RealtimeKit presets](https://developers.cloudflare.com/realtime/realtimekit/concepts/preset/).
3. Set `MEDIA_PROVIDER=realtimekit`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_REALTIMEKIT_APP_ID`, and `CLOUDFLARE_API_TOKEN` on the API and maintenance worker. Keep the token server-side. If the preset names differ, update the three `REALTIMEKIT_*_PRESET` variables in the hosted example. Apply migration `0006` before activating RealtimeKit.
4. Disable new calls and drain old media sessions before changing media provider or RealtimeKit app ID. Keep the previous media credentials available until all sessions have closed. Turn off `ENABLE_HOSTED_TEST_AGE_CHECK` and `PRODUCTION_SKIP_EMAIL_VERIFICATION` before public traffic. The public access configuration still needs Veriff, verified PostgreSQL and Redis TLS, and working email verification.
5. On staging, verify the video, voice and text presets using two browsers on different networks. Test host mute, removal, closing, blocks, suspension, and replay of original and refreshed participant tokens. Verify the worker retries provider errors, and check the Cloudflare dashboard for usage and unexpected sessions before enabling public traffic.

## Local Services test

Start the database, Redis, test mail and LiveKit dependencies, apply migrations, and run `npx vercel dev --local` from the repository root with development settings. Verify that `/api/auth/options` and `/api/ready` respond through the frontend. Use normal localhost development settings in `.env`. Vercel's production binding and provider credentials belong in the hosted environment.

## Validate before opening real traffic

Use a separate staging project with its own production deployment to test the daemon. Test with the three feature flags enabled on staging.

- Register using an ordinary email address, confirm it, complete real adult verification, and confirm an underage or unverified account cannot join. Check that no document or birth date appears in Trust Meet storage or logs. Approved documents, consent, provider retention, and support for false rejections need review for the intended market.
- On two real devices and separate networks, test audio and camera permission denial, Random Connect video, text, Next, private room approval, mute, reporting, removal and close.
- Test replay of initial and refreshed LiveKit tokens after an end, block, removal, closure and suspension. Verify the daemon stays healthy, retries failed removals and drains the queue. Enable hosting-layer abuse controls and alerts before public traffic.
- Staff report review and escalation, and rehearse suspension, media-provider outage recovery, backups and rollback.

Use an authorized operator environment with the target credentials for reports and account suspension.

```sh
python -m conviya.moderation_ops reports
python -m conviya.moderation_ops suspend --email tester@example.com --reviewer operator-id
```

For emergency shutdown, set `ENABLE_CONVERSATIONS`, `ENABLE_MATCHMAKING` and `ENABLE_PRIVATE_ROOMS` to false and redeploy the API and daemon together. Keep `PUBLIC_CONVERSATIONS=true` so the daemon continues provider revocation. Verify active media sessions stopped.

[LiveKit token refresh and revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-lifecycle)
