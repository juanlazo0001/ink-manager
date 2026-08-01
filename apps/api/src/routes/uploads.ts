import { Router } from "express";
import { cloudinary } from "../lib/cloudinary";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { Role } from "../../generated/prisma/enums";

const router = Router();

// Public: the intake form is unauthenticated, so anyone can request a
// signature scoped to the inquiries folder. Cloudinary still enforces the
// signature server-side, so this only lets the browser upload into that
// folder — it can't forge uploads elsewhere or overwrite existing assets.
const INQUIRY_UPLOAD_FOLDER = "ink-manager/inquiries";
const PORTFOLIO_UPLOAD_FOLDER = "ink-manager/portfolios";
const APPOINTMENT_PHOTO_UPLOAD_FOLDER = "ink-manager/appointment-photos";
const NOTE_ATTACHMENT_UPLOAD_FOLDER = "ink-manager/note-attachments";
const FLASH_PIECE_UPLOAD_FOLDER = "ink-manager/flash-pieces";

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

// Package N: same OWNER/FRONT_DESK gate as the photo persistence routes
// themselves (POST/DELETE /appointments/:id/photos) -- this only grants a
// signature scoped to this folder, the actual studio/appointment
// ownership check happens when the resulting URL is POSTed there.
router.get("/appointment-photo-signature", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), (_req, res) => {
  res.json(signFolder(APPOINTMENT_PHOTO_UPLOAD_FOLDER));
});

// Same OWNER/FRONT_DESK gate as the notes routes themselves (POST/PATCH
// /inquiries|appointments/:id/notes) -- this only grants a signature
// scoped to this folder; the frontend posts straight to Cloudinary's
// auto/upload endpoint (not image/upload, since attachments can be any
// file type), so no resource_type needs signing here -- only folder and
// timestamp are ever signed params.
router.get("/note-attachment-signature", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), (_req, res) => {
  res.json(signFolder(NOTE_ATTACHMENT_UPLOAD_FOLDER));
});

// Same flashGallery.manage gate as the flash-pieces routes themselves --
// this only grants a signature scoped to this folder; POST/PATCH
// /flash-pieces re-checks self-vs-staff ownership when the resulting URL
// is actually saved, same "signature isn't the ownership check" split as
// every other signature route above.
router.get("/flash-piece-signature", requireAuth, requirePermission("flashGallery.manage"), (_req, res) => {
  res.json(signFolder(FLASH_PIECE_UPLOAD_FOLDER));
});

export default router;
