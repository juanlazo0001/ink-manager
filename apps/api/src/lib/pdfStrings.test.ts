import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfT, pdfDateLocale } from "./pdfStrings";

test("pdfT interpolates {{var}} placeholders", () => {
  assert.equal(pdfT("en", "client", { name: "Jane Doe" }), "Client: Jane Doe");
  assert.equal(pdfT("es", "client", { name: "Jane Doe" }), "Cliente: Jane Doe");
});

test("pdfT falls back to English for an unrecognized locale", () => {
  assert.equal(pdfT("fr", "depositAgreementTitle"), "Deposit Agreement");
  assert.equal(pdfT(null, "depositAgreementTitle"), "Deposit Agreement");
  assert.equal(pdfT(undefined, "depositAgreementTitle"), "Deposit Agreement");
});

test("pdfT never returns an unfilled {{placeholder}} for a real key with vars supplied", () => {
  const result = pdfT("en", "emergencyContactLabel", { name: "Jane", phone: "555-0100" });
  assert.equal(result, "Emergency contact: Jane (555-0100)");
  assert.ok(!result.includes("{{"));
});

test("pdfDateLocale returns es-US only for es, en-US otherwise", () => {
  assert.equal(pdfDateLocale("es"), "es-US");
  assert.equal(pdfDateLocale("en"), "en-US");
  assert.equal(pdfDateLocale(null), "en-US");
  assert.equal(pdfDateLocale("fr"), "en-US");
});
