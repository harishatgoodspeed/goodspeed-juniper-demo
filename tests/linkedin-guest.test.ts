import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLinkedInGuest } from "../src/audit/linkedin-guest";

test("a guest LinkedIn page keeps only the public meta that is present", () => {
  const html = `<html><head>
    <meta property="og:title" content="Goodspeed Studio">
    <meta property="og:description" content="We redesign websites for funded tech companies.">
    <meta property="og:image" content="https://media.licdn.com/logo.png">
  </head><body><h2>About</h2><p>Goodspeed is a studio that redesigns websites for funded teams and ships them in weeks.</p></body></html>`;
  const guest = parseLinkedInGuest(html, 200, "https://www.linkedin.com/company/goodspeed-studio");
  assert.equal(guest.ok, true);
  assert.equal(guest.name, "Goodspeed Studio");
  assert.match(guest.tagline || "", /redesign websites/);
  assert.equal(guest.followers, null);
  assert.match(guest.about || "", /ships them in weeks/);
  assert.match(guest.imageUrl || "", /logo\.png/);
});

test("follower boilerplate and HTML entities are removed from the tagline", () => {
  const html = `<html><head>
    <meta property="og:description" content="Bent Pixels | 2,295 followers on LinkedIn. We don&#39;t buy impressions.">
  </head></html>`;
  const guest = parseLinkedInGuest(html, 200, "https://www.linkedin.com/company/bentpixels");
  assert.equal(guest.ok, true);
  assert.equal(guest.followers, "2,295");
  assert.match(guest.tagline || "", /^We don't buy impressions/);
  assert.equal((guest.tagline || "").includes("followers"), false);
});

test("a login wall, a 999, and an empty page are Couldn't read", () => {
  const wall = parseLinkedInGuest("<html><title>Sign in | LinkedIn</title><body>authwall join linkedin</body></html>", 200, "https://www.linkedin.com/authwall");
  assert.equal(wall.ok, false);
  assert.match(wall.reason || "", /^Couldn't read/);
  assert.equal(wall.tagline, null);
  const denied = parseLinkedInGuest("<html></html>", 999, "https://www.linkedin.com/company/goodspeed-studio");
  assert.equal(denied.ok, false);
  assert.match(denied.reason || "", /999/);
  const empty = parseLinkedInGuest("<html><head></head><body> </body></html>", 200, "https://www.linkedin.com/company/goodspeed-studio");
  assert.equal(empty.ok, false);
  assert.match(empty.reason || "", /no title/i);
});
