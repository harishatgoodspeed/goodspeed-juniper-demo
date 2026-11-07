import { test } from "node:test";
import assert from "node:assert/strict";
import { detectEnglishVariant, englishVariantInstruction } from "../src/english-variant";

test("detectEnglishVariant finds British spelling from real pairs", () => {
  assert.equal(detectEnglishVariant("We help you organise your colour palette and centre your brand."), "uk");
});

test("detectEnglishVariant finds American spelling from real pairs", () => {
  assert.equal(detectEnglishVariant("We help you organize your color palette and center your brand."), "us");
});

test("detectEnglishVariant returns unknown when no decisive spelling pair appears", () => {
  assert.equal(detectEnglishVariant("We help you build a great website for your team."), "unknown");
});

test("detectEnglishVariant returns unknown on an exact tie, never guessing", () => {
  // One UK-only word ("colour") and one US-only word ("color") elsewhere in the same text.
  assert.equal(detectEnglishVariant("Our colour system. Also written as color in some docs."), "unknown");
});

test("detectEnglishVariant does not match substrings across word boundaries", () => {
  // "program" must not match inside "programme" or vice versa.
  assert.equal(detectEnglishVariant("Join our programme today."), "uk");
});

test("englishVariantInstruction gives a distinct, honest instruction per variant", () => {
  assert.match(englishVariantInstruction("uk"), /British/);
  assert.match(englishVariantInstruction("us"), /American/);
  assert.match(englishVariantInstruction("unknown"), /No clear/);
});
