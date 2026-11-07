import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { serveStaticFile } from "../src/static-files";

function withTempRoot(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "static-test-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function startServer(root: string) {
  const app = express();
  app.all(/.*/, (req, res) => serveStaticFile(root, decodeURIComponent(req.path.replace(/^\//, "")), req, res));
  return app.listen(0, "127.0.0.1");
}

function portOf(server: ReturnType<typeof startServer>): number {
  return (server.address() as AddressInfo).port;
}

test("serveStaticFile returns correct MIME type and 200 for an existing file", async () => {
  const root = withTempRoot({ "styles.css": "body{color:red}" });
  const server = startServer(root);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/styles.css`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(await res.text(), "body{color:red}");
  } finally {
    server.close();
  }
});

test("serveStaticFile returns a plain 404 JSON body for a missing file, never the app shell", async () => {
  const root = withTempRoot({ "index.html": "<html></html>" });
  const server = startServer(root);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/does-not-exist.png`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.ok(!body.includes("<html"), "404 response must not be the app's index.html");
  } finally {
    server.close();
  }
});

test("serveStaticFile refuses path traversal outside the root", async () => {
  const root = withTempRoot({ "index.html": "<html></html>" });
  const secretPath = path.join(root, "..", `secret-${path.basename(root)}.txt`);
  fs.writeFileSync(secretPath, "top secret");
  const server = startServer(root);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/..%2F${path.basename(secretPath)}`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.ok(!body.includes("top secret"));
  } finally {
    server.close();
    fs.unlinkSync(secretPath);
  }
});

test("serveStaticFile supports HEAD with the same headers as GET but no body", async () => {
  const root = withTempRoot({ "a.json": JSON.stringify({ ok: true }) });
  const server = startServer(root);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/a.json`, { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(await res.text(), "");
  } finally {
    server.close();
  }
});

test("serveStaticFile rejects methods other than GET/HEAD", async () => {
  const root = withTempRoot({ "a.txt": "hi" });
  const server = startServer(root);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/a.txt`, { method: "POST" });
    assert.equal(res.status, 405);
  } finally {
    server.close();
  }
});
