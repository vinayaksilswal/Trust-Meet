import { isIP } from "node:net";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 20;

const routes = new Set(["auth", "conversations", "eligibility", "matchmaking", "me", "ready", "rooms"]);
const maxBodyBytes = 16_384;
const responseHeaders = ["content-type", "retry-after", "www-authenticate"];

function failure(status: number, detail: string) {
  return Response.json({ detail }, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: NextRequest) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let result = "", size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    result += decoder.decode(value, { stream: true });
  }
}

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!routes.has(path[0]) || path.some(segment => !/^[a-zA-Z0-9_-]+$/.test(segment))) {
    return failure(404, "Endpoint not found.");
  }

  const configured = process.env.CONVIYA_API_URL;
  const secret = process.env.TRUST_MEET_WEB_PROXY_SECRET;
  if (!configured || !secret || secret.length < 32) return failure(503, "The service is being configured.");
  let target: URL;
  try {
    target = new URL(configured);
    if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" ||
        target.search || target.hash) return failure(503, "The service is being configured.");
  } catch {
    return failure(503, "The service is being configured.");
  }

  target.pathname = "/" + path.join("/");
  target.search = request.nextUrl.search;
  const headers = new Headers({ "x-trust-meet-proxy-key": secret });
  const ip = request.headers.get("x-vercel-forwarded-for");
  if (process.env.VERCEL === "1" && ip && isIP(ip)) headers.set("x-trust-meet-client-ip", ip);
  for (const key of ["origin", "content-type", "cookie"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const body = request.method === "POST" ? await readBody(request) : undefined;
    if (body === null) return failure(413, "The request is too large.");
    const response = await fetch(target, {
      method: request.method, headers, body, cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const outgoing = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const key of responseHeaders) {
      const value = response.headers.get(key);
      if (value) outgoing.set(key, value);
    }
    for (const cookie of response.headers.getSetCookie()) outgoing.append("Set-Cookie", cookie);
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return failure(502, "Trust Meet is temporarily unavailable.");
  }
}

export { proxy as GET, proxy as POST };
