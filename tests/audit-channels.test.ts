import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverChannels, isLoginWall, readPublicChannel } from "../src/audit/channels";

const html = `<!doctype html>
<html><head>
  <script type="application/ld+json">
    {"sameAs":["https://www.linkedin.com/company/bent-pixels","https://twitter.com/bentpixels"]}
  </script>
</head><body>
  <a href="https://www.instagram.com/bentpixels/">Instagram</a>
  <a href="https://www.youtube.com/@bentpixels">YouTube</a>
  <a href="https://www.linkedin.com/sharing/share-offsite/?url=https://bentpixels.com">Share</a>
  <a href="/blog">Blog</a>
  <a href="https://twitter.com/intent/tweet?text=hi">Tweet</a>
</body></html>`;

test("discoverChannels reads sameAs, footer links, and a same site blog", () => {
  const found = discoverChannels(html, "https://www.bentpixels.com/");
  const kinds = found.map((channel) => channel.kind).sort();
  assert.deepEqual(kinds, ["blog", "instagram", "linkedin", "x", "youtube"]);
  const linkedin = found.find((channel) => channel.kind === "linkedin");
  assert.equal(linkedin?.url, "https://www.linkedin.com/company/bent-pixels");
  assert.equal(found.some((channel) => channel.url.includes("sharing")), false);
  assert.equal(found.some((channel) => channel.url.includes("intent")), false);
  const noisy = html.replace(
    "https://www.youtube.com/@bentpixels",
    "https://www.youtube.com/@someoneelse"
  );
  const again = discoverChannels(noisy, "https://www.bentpixels.com/");
  assert.equal(again.some((channel) => channel.kind === "youtube"), false);
});

test("a LinkedIn login wall is not treated as page content", () => {
  const blocked = `<html><head><title>Sign in | LinkedIn</title></head><body>Join LinkedIn and sign in to see this page.</body></html>`;
  assert.equal(isLoginWall("linkedin", "https://www.linkedin.com/authwall", "Sign in | LinkedIn", "Join LinkedIn", blocked), true);
  const page = readPublicChannel(blocked, "https://www.linkedin.com/authwall", "linkedin");
  assert.equal(page.blocked, true);
  assert.equal(page.tagline, null);
  assert.match(page.reason || "", /login/i);
});
