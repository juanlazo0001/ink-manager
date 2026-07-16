import { Router } from "express";
import { cloudinary } from "../lib/cloudinary";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";

const router = Router();

// Public: the intake form is unauthenticated, so anyone can request a
// signature scoped to the inquiries folder. Cloudinary still enforces the
// signature server-side, so this only lets the browser upload into that
// folder — it can't forge uploads elsewhere or overwrite existing assets.
const INQUIRY_UPLOAD_FOLDER = "ink-manager/inquiries";
const PORTFOLIO_UPLOAD_FOLDER = "ink-manager/portfolios";

function signFolder(folder: string) {
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, process.env.CLOUDINARY_API_SECRET as string);

  return {
    timestamp,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder,
  };
}

router.get("/signature", (_req, res) => {
  res.json(signFolder(INQUIRY_UPLOAD_FOLDER));
});

// Authenticated: only studio members who can manage artist profiles can
// upload portfolio images, scoped to their own folder.
router.get("/portfolio-signature", requireAuth, requirePermission("artists.manage"), (_req, res) => {
  res.json(signFolder(PORTFOLIO_UPLOAD_FOLDER));
});

export default router;
