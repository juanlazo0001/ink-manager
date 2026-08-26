// Outbound MMS media sizing. Run with `npx tsx --test src/lib/mmsMedia.test.ts`.
//
// Why a transform at all, from Twilio's CURRENT docs (checked, not
// remembered): a message whose body plus media exceeds 5 MB is REJECTED
// outright, Twilio recommends staying under 600 KB when you resize
// yourself, and carriers are stricter still (Verizon ~1.2 MB, T-Mobile
// ~1 MB to send). A photo straight off a phone camera is routinely 3-8 MB,
// so handing Twilio the original is a coin flip on delivery.
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MMS_MAX_MEDIA_PER_MESSAGE, toMmsDeliveryUrl } from "./cloudinary";

const ORIGINAL = "https://res.cloudinary.com/demo/image/upload/v1712345678/ink-manager/sms-media/abc123.jpg";

test("a Cloudinary delivery URL gains the carrier-sized transform", () => {
  const out = toMmsDeliveryUrl(ORIGINAL);
  assert.match(out, /\/image\/upload\/f_jpg,q_auto:good,w_1600,h_1600,c_limit\//);
  // The asset path itself must survive untouched -- the transform is
  // inserted, never substituted for part of the URL.
  assert.ok(out.endsWith("/v1712345678/ink-manager/sms-media/abc123.jpg"));
});

test("the transform is inserted immediately after /image/upload/", () => {
  const out = toMmsDeliveryUrl(ORIGINAL);
  const marker = "/image/upload/";
  assert.equal(out.slice(out.indexOf(marker) + marker.length).startsWith("f_jpg,"), true);
});

test("applying it twice is a no-op -- transforms never stack", () => {
  // Matters because the send path maps over attachments each time; a retry
  // or a re-send must not produce f_jpg.../f_jpg.../ and a broken URL.
  const once = toMmsDeliveryUrl(ORIGINAL);
  assert.equal(toMmsDeliveryUrl(once), once);
});

test("a non-Cloudinary URL is returned untouched rather than corrupted", () => {
  // Better to hand Twilio an original it can resize itself than to mangle a
  // URL shape this function does not understand.
  const foreign = "https://example.com/photos/tattoo.jpg";
  assert.equal(toMmsDeliveryUrl(foreign), foreign);
  const twilioMedia = "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM1/Media/ME1";
  assert.equal(toMmsDeliveryUrl(twilioMedia), twilioMedia);
});

test("a Cloudinary VIDEO url is left alone -- the image transform would not apply", () => {
  const video = "https://res.cloudinary.com/demo/video/upload/v1/clip.mp4";
  assert.equal(toMmsDeliveryUrl(video), video);
});

test("the per-message media cap matches Twilio's documented limit of ten", () => {
  assert.equal(MMS_MAX_MEDIA_PER_MESSAGE, 10);
});
