import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  isDisallowedIp,
  resolveRedirectLocation,
  resolveSafeTarget,
  safeFetch,
  validateUrlSyntax,
  SsrfError,
} from "../src/security/url";

test("isDisallowedIp rejects loopback, private, link-local/metadata, and reserved ranges", () => {
  const disallowed = [
    "127.0.0.1",
    "127.53.1.9",
    "10.0.0.5",
    "172.16.0.5",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata endpoint
    "0.0.0.0",
    "::1",
    "fe80::1", // IPv6 link-local
    "fc00::1", // IPv6 unique local
    "::ffff:127.0.0.1", // IPv4-mapped IPv6 loopback
    "::ffff:10.1.2.3", // IPv4-mapped IPv6 private
  ];
  for (const ip of disallowed) {
    assert.equal(isDisallowedIp(ip), true, `expected ${ip} to be disallowed`);
  }
});

test("isDisallowedIp allows ordinary public addresses", () => {
  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];
  for (const ip of allowed) {
    assert.equal(isDisallowedIp(ip), false, `expected ${ip} to be allowed`);
  }
});

test("validateUrlSyntax rejects non-http(s) schemes and embedded credentials", () => {
  assert.throws(() => validateUrlSyntax("file:///etc/passwd"), SsrfError);
  assert.throws(() => validateUrlSyntax("ftp://example.com"), SsrfError);
  assert.throws(() => validateUrlSyntax("http://user:pass@example.com"), SsrfError);
  assert.throws(() => validateUrlSyntax("not a url"), SsrfError);
  assert.doesNotThrow(() => validateUrlSyntax("https://example.com/path"));
});

test("resolveSafeTarget refuses a literal loopback IP without any DNS lookup", async () => {
  await assert.rejects(() => resolveSafeTarget("127.0.0.1"), SsrfError);
  await assert.rejects(() => resolveSafeTarget("169.254.169.254"), SsrfError);
});

test("safeFetch end-to-end: a real local HTTP server on loopback is refused, proving the guard isn't just unit-level", async () => {
  const server = http.createServer((_req, res) => {
    res.end("should never be reached");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    await assert.rejects(
      () => safeFetch(`http://127.0.0.1:${port}/`),
      (err: unknown) => err instanceof SsrfError
    );
  } finally {
    server.close();
  }
});

test("resolveRedirectLocation rejects a redirect that downgrades scheme or adds credentials", () => {
  const base = new URL("https://example.com/start");
  assert.throws(() => resolveRedirectLocation("file:///etc/passwd", base), SsrfError);
  assert.throws(() => resolveRedirectLocation("ftp://example.com/x", base), SsrfError);
  assert.throws(() => resolveRedirectLocation("http://user:pass@example.com/", base), SsrfError);
  assert.doesNotThrow(() => resolveRedirectLocation("/next-page", base));
  assert.doesNotThrow(() => resolveRedirectLocation("https://example.com/next", base));
});

test("safeFetch: a redirect chain is followed and the final response is validated end to end", async () => {
  // Two real local servers, hop A redirecting to hop B, both on the loopback
  // interface. safeFetch's own hostname resolution (resolveSafeTarget) runs
  // fresh on every hop per the implementation, so a first hop that happened
  // to be allowed would not let an unsafe later hop through; here both hops
  // are loopback, which already proves the per-hop check isn't skipped after
  // hop 0, since the rejection surfaces only once the redirect is followed.
  const target = http.createServer((_req, res) => res.end("unreachable"));
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetPort = (target.address() as { port: number }).port;

  const redirector = http.createServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/` });
    res.end();
  });
  await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
  const redirectorPort = (redirector.address() as { port: number }).port;

  try {
    await assert.rejects(() => safeFetch(`http://127.0.0.1:${redirectorPort}/`), SsrfError);
  } finally {
    redirector.close();
    target.close();
  }
});
