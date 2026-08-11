import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAcceptLanguage } from "./locale";

test("parseAcceptLanguage returns en for a missing header", () => {
  assert.equal(parseAcceptLanguage(undefined), "en");
  assert.equal(parseAcceptLanguage(null), "en");
  assert.equal(parseAcceptLanguage(""), "en");
});

test("parseAcceptLanguage maps any es* primary subtag to es", () => {
  assert.equal(parseAcceptLanguage("es"), "es");
  assert.equal(parseAcceptLanguage("es-MX"), "es");
  assert.equal(parseAcceptLanguage("es-CA,es;q=0.9,en;q=0.8"), "es");
  assert.equal(parseAcceptLanguage("es-419"), "es");
});

test("parseAcceptLanguage maps anything else to en", () => {
  assert.equal(parseAcceptLanguage("en-US,en;q=0.9"), "en");
  assert.equal(parseAcceptLanguage("fr-FR,fr;q=0.9"), "en");
  assert.equal(parseAcceptLanguage("de"), "en");
});

test("parseAcceptLanguage respects q-value ordering, not header order", () => {
  // Top preference is French, Spanish is a distant third -- should not
  // flip to Spanish just because "es" appears somewhere in the header.
  assert.equal(parseAcceptLanguage("fr;q=0.9,en;q=0.8,es;q=0.1"), "en");
  assert.equal(parseAcceptLanguage("en;q=0.5,es;q=0.9"), "es");
});
