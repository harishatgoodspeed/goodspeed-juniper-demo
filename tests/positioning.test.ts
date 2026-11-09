import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanChannelText, readPositioning, storiesDiffer, storyVerdict } from "../src/audit/positioning";

const site = "Channel-level precision, creator-level impact. Bent Pixels drives YouTube results with smart media, optimized channels, and creator partnerships since 2009.";
const linkedin = "Bent Pixels | 2,295 followers on LinkedIn. The Original Creator TV Platform. Creator-led advertising that drives measurable growth for the world's top brands.";
const youtube = "Bent Pixels is a revenue accelerator that empowers creators, agencies and management companies to scale. Paladin technology.";

test("LinkedIn boilerplate and HTML entities are stripped before the story is read", () => {
  const cleaned = cleanChannelText("Bent Pixels | 2,295 followers on LinkedIn. We don&#39;t buy impressions.");
  assert.equal(cleaned.followers, "2,295");
  assert.match(cleaned.text, /^We don't buy impressions/i);
  assert.equal(cleaned.text.includes("followers"), false);
  assert.equal(cleaned.text.includes("&#39;"), false);
});

test("Bent Pixels site, LinkedIn, and YouTube are three different stories", () => {
  const siteStory = readPositioning(site, "Bent Pixels");
  const linkedinStory = readPositioning(linkedin, "Bent Pixels");
  const youtubeStory = readPositioning(youtube, "Bent Pixels");
  assert.equal(siteStory.sells, "YouTube channel growth");
  assert.equal(linkedinStory.sells, "a Creator TV ad platform");
  assert.equal(youtubeStory.sells, "a revenue accelerator");
  assert.equal(storiesDiffer(siteStory.tokens, linkedinStory.tokens), true);
  assert.equal(storiesDiffer(siteStory.tokens, youtubeStory.tokens), true);
  const line = storyVerdict(siteStory.sells, [
    { label: "LinkedIn", sells: linkedinStory.sells },
    { label: "YouTube", sells: youtubeStory.sells },
  ]);
  assert.match(line, /Site sells YouTube channel growth/);
  assert.match(line, /LinkedIn sells a Creator TV ad platform/);
  assert.match(line, /YouTube sells a revenue accelerator/);
  assert.doesNotMatch(line, /followers/);
});

test("a matching blog stays on the same offer, and a different LinkedIn line stays readable", () => {
  const site = readPositioning(
    "We redesign websites for funded tech companies whose site no longer matches the business.",
    "Goodspeed"
  );
  const blog = readPositioning(
    "Practical web design guides from Goodspeed, the studio behind websites for funded tech companies: redesigns, migrations, AI search, Framer and pricing.",
    "Goodspeed"
  );
  const linkedin = readPositioning("Websites, products and the AI agents behind them. Agency of the Year 2025.", "Goodspeed");
  assert.equal(site.sells, "website redesign");
  assert.equal(blog.sells, "website redesign");
  assert.equal(storiesDiffer(site.tokens, blog.tokens), false);
  assert.equal(storiesDiffer(site.tokens, linkedin.tokens), true);
  assert.match(linkedin.sells, /products and the AI agents/);
});
