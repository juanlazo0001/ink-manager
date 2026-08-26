import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

const SMS_MEDIA_FOLDER = "ink-manager/sms-media";

// Twilio's MediaUrl0/1/... links expire and require the studio's own
// Twilio Basic Auth to fetch even while they're live -- Cloudinary's
// remote-fetch upload (passing a bare URL) can't attach that auth header
// itself, so this downloads the media server-side first (authenticated),
// then hands Cloudinary the bytes directly as a data URI rather than a URL
// for it to fetch on its own.
export async function reuploadTwilioMedia(mediaUrl: string, accountSid: string, authToken: string): Promise<string> {
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });

  if (!response.ok) {
    throw new Error(`Failed to fetch Twilio media (${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const dataUri = `data:${contentType};base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, { folder: SMS_MEDIA_FOLDER });
  return result.secure_url;
}

// --- Outbound MMS ------------------------------------------------------

// Twilio's own numbers, taken from its current docs rather than memory:
//   * up to TEN MediaUrl values per message
//   * 5 MB total for the fully-supported image types (jpeg/jpg/png/gif),
//     500 KB for anything else accepted -- and a message whose body plus
//     media exceeds 5 MB is REJECTED outright, not truncated
//   * Twilio recommends staying under 600 KB when you resize yourself
//   * carriers are stricter still: Verizon caps around 1.2 MB, T-Mobile
//     around 1 MB for sending, and an over-size image is rejected or
//     silently recompressed by the carrier
//
// Hence: never hand Twilio the original off a modern phone camera (3-8 MB
// is routine). Twilio does auto-resize png/gif/jpg, but relying on that
// means the delivered image is whatever their resizer decided, and any
// non-image attachment gets no such help at all.
export const MMS_MAX_MEDIA_PER_MESSAGE = 10;

// Comfortably under Twilio's 600 KB guidance and every carrier cap above,
// while still looking fine full-screen on a phone. q_auto:good lets
// Cloudinary pick the quality that hits its own perceptual target rather
// than pinning an arbitrary number.
const MMS_TRANSFORM = "f_jpg,q_auto:good,w_1600,h_1600,c_limit";

// Rewrites a Cloudinary delivery URL to serve a carrier-friendly rendition
// instead of the original upload. Deliberately a URL rewrite rather than a
// re-upload: Cloudinary generates and caches the derived image on first
// request, so this costs no storage, no extra API call, and no upload
// round-trip on the send path -- Twilio's fetch of the URL is what
// materialises it.
//
// The ORIGINAL url is what stays on the Message row and what staff see in
// the thread; only the copy handed to Twilio is downscaled. A studio
// looking back at what they sent should see their real photo, not a
// carrier-grade recompression of it.
//
// Anything that isn't a recognisable Cloudinary image delivery URL is
// returned untouched -- better to hand Twilio the original and let it
// resize than to corrupt a URL shape this doesn't understand.
export function toMmsDeliveryUrl(url: string): string {
  // Standard shape: https://res.cloudinary.com/<cloud>/image/upload/<...>
  // The transform slots directly after "/upload/". A URL that already has
  // one is left alone rather than stacking a second.
  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const after = url.slice(at + marker.length);
  if (after.startsWith(`${MMS_TRANSFORM}/`)) return url;

  return `${url.slice(0, at + marker.length)}${MMS_TRANSFORM}/${after}`;
}
