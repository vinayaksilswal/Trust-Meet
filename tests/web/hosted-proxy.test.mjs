import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "../../apps/web/app/api/[...path]/route.ts";

test("hosted proxy signs requests, forwards sessions, and enforces the route and body limits", async t => {
  const secret = "p".repeat(48);
  const original = { ...process.env };
  t.after(() => {
    for (const key of ["VERCEL", "CONVIYA_API_URL", "TRUST_MEET_WEB_PROXY_SECRET"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  process.env.VERCEL = "1";
  process.env.CONVIYA_API_URL = "https://api.example.com";
  process.env.TRUST_MEET_WEB_PROXY_SECRET = secret;
  const forwarding = t.mock.method(globalThis, "fetch", async (target, options) => {
    assert.equal(target.href, "https://api.example.com/auth/login");
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
});
