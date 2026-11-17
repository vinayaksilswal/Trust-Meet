# Trust Meet

For Vercel, follow the [multi-service deployment guide](docs/DEPLOYMENT.md). It covers the frontend, internal FastAPI service, maintenance daemon, public signup and live provider checks.

Trust Meet is an India-first platform for adult conversation. The local development stack includes password sign-in, a date-of-birth check, Random Connect with Redis-backed matchmaking, and private rooms. LiveKit carries text, voice and video in local development.

## Run locally with Docker

1. Install Docker with Compose v2. Run `docker compose up --build --wait` from the repository root.
2. Open [Trust Meet](http://localhost:3000) and [Mailpit](http://localhost:8025). Use the localhost URL because browser origin checks are strict.
3. Create an account with a synthetic address such as `ananya@example.com`. Open the verification email in Mailpit, select the link and verify. Sign in and submit a synthetic adult birth date.
4. In a separate browser profile or private window, repeat these steps with a second synthetic address, such as `amit@example.com`.
5. In Random Connect, choose the same mode in both profiles. Select **Find a match** and accept on both sides. To connect directly, select **Create invitation** and open its link in the second profile.
6. For a group session, create a Private Room, share its invitation link, and approve requests in **Host controls**. Guests and hosts select **Join call** when the room opens.

Run `docker compose down` to stop the services. The PostgreSQL volume persists accounts across restarts. Development services and test credentials are for loopback use.

## Test on two devices over Wi-Fi

The Windows LAN launcher uses the native development services, the optimized Next.js build, and a certificate for the host's private IPv4 address. Run one application stack per development database.

1. Use the host's Wi-Fi IPv4 address. With mkcert available, set `$env:CAROOT` to the workspace's `.local/lan` directory and generate `site.pem` and `site-key.pem` there using `mkcert -cert-file .local/lan/site.pem -key-file .local/lan/site-key.pem <host-ip>`.
2. From the repository root, run `npm run build`, then `./scripts/Start-TrustMeetLan.ps1 -Address <host-ip>`. The launcher expects the native Windows development binaries and Python environment in `.local` and `.venv`.
3. On each test device, trust the local CA certificate and open `https://<host-ip>:3443`. Share only the public CA certificate, such as `trust-meet-local-ca.cer`. Keep both private key files on the host. On iPhone or iPad, enable full trust after installing the certificate. [Apple certificate trust](https://support.apple.com/en-us/102390) · [Android certificate installation](https://support.google.com/pixelphone/answer/2844832)
4. Sign in with a different account on each device and complete the date-of-birth check. In **Private Rooms**, create a room in **Video** mode. Share the invitation, approve the guest, then select **Join call** on both devices and enable the camera and microphone. For a one-to-one test, use **Random Connect** and create an invitation or match from both devices.

The gateway serves TCP 3443 and LiveKit receives media on UDP 7892. Use the same Wi-Fi network and allow those ports within the local subnet if the host firewall requires it. The API, database, Redis and Mailpit use loopback, and the LAN launcher keeps production gates in place. Run `./scripts/Stop-TrustMeetLan.ps1` to stop the LAN test processes.


## Run with native dependencies

Use Python 3.11 and Node.js 24 along with PostgreSQL, Redis, a loopback SMTP inbox such as Mailpit, and the LiveKit development server. Start the dependencies, copy `.env.example` to `.env`, and set the API connection strings and ports. Keep `WEB_ORIGIN=http://localhost:3000`.

```sh
python -m venv .venv
# Activate .venv for your shell before running the remaining commands.
python -m pip install -r services/api/requirements.txt -r services/api/requirements-dev.txt
python -m alembic -c services/api/alembic.ini upgrade head
python -m uvicorn --app-dir services/api conviya.main:app --loop conviya.event_loop:factory --host 127.0.0.1 --port 8000 --no-access-log
```

In another terminal run `npm ci` and `npm run dev`. The web app proxies `/api` to port 8000. Set `CONVIYA_API_URL` for a different upstream. Run local LiveKit with `--dev --bind 127.0.0.1 --node-ip 127.0.0.1`.

## Verify

With the local stack running, run `python -m pytest -q`, `npx playwright install chromium` and `npm run test:e2e`. Tests use real PostgreSQL, Redis, Mailpit and LiveKit. Browser media verification uses synthetic devices.

See [architecture](docs/ARCHITECTURE.md), [delivery roadmap](docs/ROADMAP.md), [test results](docs/TEST_REPORT.md) and [open launch gates](docs/PRODUCTION_READINESS.md).
