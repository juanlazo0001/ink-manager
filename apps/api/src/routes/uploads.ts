import { Router } from "express";
import { cloudinary } from "../lib/cloudinary";

const router = Router();

// Public: the intake form is unauthenticated, so anyone can request a
// signature scoped to the inquiries folder. Cloudinary still enforces the
// signature server-side, so this only lets the browser upload into that
// folder — it can't forge uploads elsewhere or overwrite existing assets.
const INQUIRY_UPLOAD_FOLDER = "ink-manager/inquiries";

router.get("/signature", (_req, res) => {
  const timestamp = Math.round(Date.now() / 1000);
  const paramsToSign = { timestamp, folder: INQUIRY_UPLOAD_FOLDER };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET as string);

  res.json({
    timestamp,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder: INQUIRY_UPLOAD_FOLDER,
  });
});

export default router;
