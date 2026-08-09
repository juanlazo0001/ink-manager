import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRequestLocale, withLocale, resolveSystemFieldLabel } from "./contentTranslation";

test("resolveRequestLocale prefers an explicit query param over everything else", () => {
  assert.equal(resolveRequestLocale("es", "en", "en"), "es");
});

test("resolveRequestLocale falls back to the client's own preferredLocale when no query param", () => {
  assert.equal(resolveRequestLocale(undefined, "es", "en"), "es");
  assert.equal(resolveRequestLocale(null, "es", "en"), "es");
});

test("resolveRequestLocale falls back to the studio's defaultLocale when neither query nor client preference exists", () => {
  assert.equal(resolveRequestLocale(undefined, null, "es"), "es");
});

test("resolveRequestLocale falls back to en when nothing resolves", () => {
  assert.equal(resolveRequestLocale(undefined, null, null), "en");
  assert.equal(resolveRequestLocale("fr", "fr", "fr"), "en");
});

test("withLocale returns the base object untouched when no translation row exists", () => {
  const base = { title: "English Title", body: "English Body" };
  assert.deepEqual(withLocale(base, null, ["title", "body"]), base);
  assert.deepEqual(withLocale(base, undefined, ["title", "body"]), base);
});

test("withLocale overrides only fields the translation row actually has non-empty values for", () => {
  const base = { title: "English Title", body: "English Body", note: "English Note" };
  const translated = withLocale(base, { title: "Título en Español", body: "" }, ["title", "body", "note"]);
  assert.equal(translated.title, "Título en Español");
  assert.equal(translated.body, "English Body"); // empty string in translation -> falls back
  assert.equal(translated.note, "English Note"); // field absent from translation row -> falls back
});

test("withLocale never mutates the original base object", () => {
  const base = { title: "English Title" };
  withLocale(base, { title: "Título" }, ["title"]);
  assert.equal(base.title, "English Title");
});

test("resolveSystemFieldLabel: en locale always returns the live English label untouched", () => {
  assert.equal(resolveSystemFieldLabel("name", "Name", "en", null), "Name");
  assert.equal(resolveSystemFieldLabel("name", "Custom Name Label", "en", null), "Custom Name Label");
});

test("resolveSystemFieldLabel: a studio's own translation row always wins when present", () => {
  assert.equal(resolveSystemFieldLabel("name", "Name", "es", "Nombre Personalizado"), "Nombre Personalizado");
  // Even if the studio also customized the English away from the seed.
  assert.equal(resolveSystemFieldLabel("name", "Full Legal Name", "es", "Nombre Legal"), "Nombre Legal");
});

test("resolveSystemFieldLabel: SEED-EQUALITY -- byte-identical to the platform seed gets the platform Spanish default", () => {
  // "Name" is the exact SYSTEM_FIELD_DEFAULTS seed for key "name".
  assert.equal(resolveSystemFieldLabel("name", "Name", "es", null), "Nombre");
  assert.equal(resolveSystemFieldLabel("description", "Describe the tattoo you want", "es", null), "Describe el tatuaje que quieres");
});

test("resolveSystemFieldLabel: the moment English diverges from the seed, the platform Spanish default no longer applies", () => {
  // Studio edited the English label away from the seed ("Name" -> "Full Name")
  // and has NOT supplied their own Spanish translation yet -- falls back to
  // their own (now-diverged) English, never the platform's stale seed
  // translation for the ORIGINAL wording.
  assert.equal(resolveSystemFieldLabel("name", "Full Name", "es", null), "Full Name");
});

test("resolveSystemFieldLabel: a CUSTOM field (no systemFieldKey) never gets a platform seed translation", () => {
  assert.equal(resolveSystemFieldLabel(null, "What's your favorite color?", "es", null), "What's your favorite color?");
});
