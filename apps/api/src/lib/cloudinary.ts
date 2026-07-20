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
