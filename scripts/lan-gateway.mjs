import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { BlockList, isIPv4 } from "node:net";
import { createProxyServer, proxyUpgrade } from "httpxy";

const [address, prefixText] = process.argv.slice(2);
const prefix = Number(prefixText);
const privateLan = new BlockList();
privateLan.addSubnet("10.0.0.0", 8);
privateLan.addSubnet("172.16.0.0", 12);
privateLan.addSubnet("192.168.0.0", 16);
if (!isIPv4(address) || !privateLan.check(address) || !Number.isInteger(prefix) || prefix < 8 || prefix > 32) {
  throw new Error("Supply the host's private LAN address and subnet prefix.");
}

const localSubnet = new BlockList();
localSubnet.addSubnet(address, prefix);
const host = address + ":3443";
const origin = "https://" + host;
const frontend = "http://127.0.0.1:3310";
const backend = "http://127.0.0.1:8810";
const signaling = "http://127.0.0.1:7890";
const proxy = createProxyServer({ xfwd: true });
const isSignaling = path => path === "/rtc" || path.startsWith("/rtc/");

function prepare(request) {
  const remote = request.socket.remoteAddress;
  if (!remote || !privateLan.check(remote) || !localSubnet.check(remote) || request.headers.host !== host) return null;
  if (!request.url?.startsWith("/") || request.url.startsWith("//")) return null;
  for (const header of Object.keys(request.headers)) {
    if (header === "forwarded" || header.startsWith("x-forwarded-")) delete request.headers[header];
  }
  return request.url.split("?", 1)[0];
}

const server = createServer({
  cert: readFileSync(".local/lan/site.pem"),
  key: readFileSync(".local/lan/site-key.pem"),
}, async (request, response) => {
  const path = prepare(request);
  if (!path) {
    response.writeHead(403).end();
    return;
  }

  let target = frontend;
  if (path.startsWith("/api/")) {
    request.url = request.url.slice(4);
    target = backend;
  } else if (isSignaling(path)) {
    target = signaling;
  }

  try {
    await proxy.web(request, response, { target });
  } catch {
    if (response.headersSent) response.destroy();
    else response.writeHead(502).end("Trust Meet is temporarily unavailable.");
  }
});

server.on("upgrade", (request, socket, head) => {
  const path = prepare(request);
  if (!path || !isSignaling(path) || request.headers.origin !== origin) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  void proxyUpgrade(signaling, request, socket, head, { upgradeTimeout: 5_000 }).catch(() => {});
});

server.listen(3443, address, () => console.log("Trust Meet LAN test at " + origin));
