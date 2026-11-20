import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "../../apps/web/app/api/[...path]/route.ts";

test("hosted proxy signs requests, forwards sessions, and enforces the route and body limits", async t => {
  const secret = "p".repeat(48);
  const original = { ...process.env };
  t.after(() => {
    for (const key of ["VERCEL", "VERCEL_ENV", "TRUST_MEET_API_URL", "CONVIYA_API_URL", "TRUST_MEET_WEB_PROXY_SECRET"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.TRUST_MEET_API_URL = "https://internal.example.com/service/api/";
  process.env.CONVIYA_API_URL = "https://legacy.example.com";
  process.env.TRUST_MEET_WEB_PROXY_SECRET = secret;
  const forwarding = t.mock.method(globalThis, "fetch", async (target, options) => {
    assert.equal(target.href, "https://internal.example.com/service/api/auth/login");
    assert.equal(options.headers.get("x-trust-meet-proxy-key"), secret);
    assert.equal(options.headers.get("x-trust-meet-client-ip"), "203.0.113.9");
    assert.equal(options.headers.get("cookie"), "__Host-conviya=opaque");
    assert.equal(options.headers.get("origin"), "https://meet.example.com");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, '{"email":"adult@example.com"}');
    return new Response('{"message":"Signed in."}', {
      headers: { "set-cookie": "__Host-conviya=new; Secure; HttpOnly; Path=/", "x-upstream": "internal" },
    });
  });
  const makeRequest = (path, options) => {
    const url = new URL("https://meet.example.com/api/" + path.join("/"));
    const request = new Request(url, options);
    return [Object.assign(request, { nextUrl: url }), { params: Promise.resolve({ path }) }];
  };
  const response = await POST(...makeRequest(["auth", "login"], {
    method: "POST", body: '{"email":"adult@example.com"}',
    headers: {
      cookie: "__Host-conviya=opaque", origin: "https://meet.example.com",
      "x-vercel-forwarded-for": "203.0.113.9", "x-trust-meet-proxy-key": "spoof",
      "x-trust-meet-client-ip": "192.0.2.1",
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-upstream"), null);
  assert.match(response.headers.get("set-cookie"), /__Host-conviya=new; Secure; HttpOnly/);
  assert.equal((await GET(...makeRequest(["internal"]))).status, 404);
  assert.equal((await POST(...makeRequest(["auth", "login"], { method: "POST", body: "x".repeat(16_385) }))).status, 413);
  assert.equal(forwarding.mock.callCount(), 1);
  delete process.env.TRUST_MEET_API_URL;
  assert.equal((await GET(...makeRequest(["auth", "options"]))).status, 503);
});

test("billing webhooks forward only the Razorpay signature, not browser credentials", async t => {
  const original = { ...process.env };
  t.after(() => {
    for (const key of ["VERCEL", "VERCEL_ENV", "TRUST_MEET_API_URL", "TRUST_MEET_WEB_PROXY_SECRET"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.TRUST_MEET_API_URL = "https://internal.example.com/api/";
  process.env.TRUST_MEET_WEB_PROXY_SECRET = "p".repeat(48);
  const body = JSON.stringify({ event: "subscription.charged", padding: "x".repeat(20_000) });
  t.mock.method(globalThis, "fetch", async (target, options) => {
    assert.equal(target.href, "https://internal.example.com/api/billing/webhook");
    assert.equal(options.headers.get("x-razorpay-signature"), "a".repeat(64));
    assert.equal(options.headers.get("x-razorpay-event-id"), "evt_sample");
    assert.equal(options.headers.get("cookie"), null);
    assert.equal(options.headers.get("origin"), null);
    assert.equal(options.body, body);
    return Response.json({ status: "processed" });
  });
  const request = new Request("https://meet.example.com/api/billing/webhook", {
    method: "POST", body,
    headers: { "content-type": "application/json", "x-razorpay-signature": "a".repeat(64),
      "x-razorpay-event-id": "evt_sample", cookie: "__Host-conviya=opaque", origin: "https://evil.example" },
  });
  request.nextUrl = new URL(request.url);
  const response = await POST(request, { params: Promise.resolve({ path: ["billing", "webhook"] }) });
  assert.equal(response.status, 200);
});
