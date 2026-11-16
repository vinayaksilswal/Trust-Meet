# Deploy Trust Meet

The hosted configuration supports an invite-only beta for Random Connect and Private Rooms. Keep all conversation flags off until the hosted checks below pass. Public access needs approved scalable age assurance, staffed review and a production safety assessment.

## 1. Host the FastAPI service

Build the existing image from the repository root with `docker build -f services/api/Dockerfile -t trust-meet-api .`. Deploy it to a managed container platform with a persistent instance and HTTPS ingress. The image runs the FastAPI process and its cleanup worker. Configure `/health` as a liveness check, keep at least one instance running, and disable scale-to-zero. Keep PostgreSQL and Redis private to the hosting network when the providers support it.

Set the variables from [the hosted environment example](../.env.hosted.example). Use a fresh PostgreSQL database and Redis instance. Use verified TLS for both and a dedicated LiveKit Cloud project for each environment. In the migration job, run `alembic upgrade head` before sending traffic. Do not copy local account data or point the hosted release at the LAN database.

Set `WEB_ORIGIN` to the exact HTTPS frontend domain without a trailing slash. Generate an independent proxy secret, for example with `openssl rand -hex 32`. Set it as `WEB_PROXY_SECRET` on the API host. Send account emails via Resend SMTP on port 587 with STARTTLS and a verified sender. Configure the SMTP API key, database password, Redis credentials and LiveKit secret on the API host only. [Resend SMTP configuration](https://resend.com/changelog/smtp-service) · [LiveKit Project URL](https://docs.livekit.io/intro/basics/connect/)

## 2. Import the repository into Vercel

- Framework preset **Next.js**
- Root Directory **apps/web**
- Enable **Include source files outside of the Root Directory in the Build Step** for the shared packages.
- Select **Node.js 24.x**. Use the default install, build and output settings.
- Add **CONVIYA_API_URL** with the API's HTTPS origin, such as `https://api.example.com`.
- Add **TRUST_MEET_WEB_PROXY_SECRET** as a sensitive server-side variable with the same value as `WEB_PROXY_SECRET`. Avoid the `NEXT_PUBLIC_` prefix.
- Assign the frontend domain you entered as `WEB_ORIGIN`. Give Preview its own API, credentials and canonical domain if you need end-to-end preview testing.

The frontend's same-origin API route passes the session cookie to FastAPI and authenticates the proxy hop. Clients establish media directly with LiveKit Cloud. FastAPI rejects unsigned requests except for its liveness check. [Vercel monorepo project settings](https://vercel.com/docs/monorepos/monorepo-faq) · [Vercel request headers](https://vercel.com/docs/headers/request-headers)

## 3. Admit two reviewed adult testers and verify staging

Run the operator command inside the API host or an authorized one-off container with the same environment. Verify each adult and their association with the invited email under your approved review procedure before running the command. Use individual operator accounts with MFA enforced by the hosting provider. Keep identity documents and dates of birth out of the command and application database.

```sh
python -m conviya.beta_ops admit --email tester@example.com --reviewer operator-id --adult-reviewed
python -m conviya.beta_ops reports
python -m conviya.beta_ops suspend --email tester@example.com --reviewer operator-id
```

Ask the two testers to register with their admitted email addresses and complete email confirmation. An uninvited address receives a neutral response and cannot sign in. An approved tester's eligibility follows their reviewed admission and email confirmation.

In a separate staging environment, enable `ENABLE_CONVERSATIONS`, `ENABLE_MATCHMAKING`, and `ENABLE_PRIVATE_ROOMS` and verify all of the following before setting the same flags on your beta deployment.

- Frontend `/api/ready` responds through Vercel. Direct API access fails except for `/health`. An unlisted tester cannot register or sign in. Resend delivers verification and recovery links to both invited testers.
- From two separate networks and real devices, run a random video match and a private video room. Test Next, reconnection, waiting-room admission, mute, report, removal and closure.
- Save separate valid and refreshed test tokens. Replay them directly after an end, block, host removal, room closure and operator suspension, including when the participant has already disconnected. Check that the worker drains pending removals and revokes media through the provider. [LiveKit token refresh and revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-lifecycle)
- Assign a human operator to review reports and rehearse suspension, provider outage recovery, backups and rollback.

For emergency shutdown, set all three feature flags to false and restart the API with the hosted beta configuration still enabled so cleanup can continue. Check the API and LiveKit logs and verify that sessions stopped. If the worker or provider is unavailable, use the LiveKit console to end active sessions and disable media access under your incident procedure.
