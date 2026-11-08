import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

function slice(from: string, to: string): string {
  const start = html.indexOf(from);
  const end = html.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `missing ${from} … ${to}`);
  return html.slice(start, end);
}

const landing = slice('<section id="urlView">', '<section id="progressView"');
const progress = slice('<section id="progressView"', '<section id="confirmView"');

test("landing shows Bent Pixels examples before the URL box", () => {
  const examples = landing.indexOf('class="examples"');
  const form = landing.indexOf('id="importForm"');
  assert.ok(examples >= 0 && form > examples, "examples must come before the URL form");
  assert.match(landing, /Bent Pixels/);
  assert.match(landing, />Carousel</);
  assert.match(landing, />Checklist</);
  assert.match(landing, />Hook</);
  assert.match(landing, /Text only/);
  assert.match(landing, /We don't buy impressions/);
  assert.match(landing, /100\+/);
  assert.match(landing, /100M\+/);
  assert.match(landing, /PixelFusion/);
  assert.match(landing, /C\.R\.E\.D\./);
  assert.match(landing, /Topper Guild/);
  assert.match(landing, /91\.1M/);
  assert.match(landing, /bent-pixels-wordmark\.png/);
  assert.equal(landing.includes("0B+"), false);
  assert.equal(/d2c/i.test(landing), false);
  assert.equal(landing.includes('type="email"'), false);
  assert.equal(/sign-up|signup/i.test(landing.replace("no sign-up", "")), false);
  assert.match(landing, /No email and no sign-up/);
  assert.equal(fs.existsSync(path.join(root, "public/bent-pixels-wordmark.png")), true);
});

test("landing names Bent Pixels as the only sample brand", () => {
  assert.match(landing, /only sample brand/);
  assert.equal(landing.includes("What you get"), false);
  assert.equal(landing.includes("proof led"), false);
});

test("extraction progress is a visible live stepper", () => {
  assert.match(progress, /id="extractSteps"/);
  assert.match(progress, /data-step="reading_website"/);
  assert.match(progress, /data-step="finding_brand"/);
  assert.match(progress, /id="extractClock"/);
  assert.match(progress, /id="progressText"/);
  assert.match(progress, /aria-live="polite"/);
  assert.match(app, /function renderExtractProgress/);
  assert.match(app, /function startExtractClock/);
  assert.match(app, /reading_website/);
  assert.match(app, /finding_brand/);
  assert.match(css, /\.extract-steps/);
  assert.match(css, /extract-pulse/);
});

test("the Bent Pixels wordmark is served with the landing page", async () => {
  const { app } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.match(body, /bent-pixels-wordmark\.png/);
    assert.match(body, /id="extractSteps"/);
    const logo = await fetch(`${base}/bent-pixels-wordmark.png`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get("content-type") || "", /image\/png/);
    const bytes = Buffer.from(await logo.arrayBuffer());
    assert.ok(bytes.length > 100);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    server.close();
  }
});
