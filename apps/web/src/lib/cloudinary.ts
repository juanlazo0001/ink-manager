import { apiFetch } from './api'

interface UploadSignature {
  timestamp: number
  signature: string
  apiKey: string
  cloudName: string
  folder: string
}

// Fetched fresh per upload rather than cached/reused, so a form left open
// past Cloudinary's signature freshness window can't produce stale-signature
// upload failures.
async function getUploadSignature(): Promise<UploadSignature> {
  return apiFetch<UploadSignature>('/uploads/signature')
}

async function getPortfolioUploadSignature(): Promise<UploadSignature> {
  return apiFetch<UploadSignature>('/uploads/portfolio-signature')
}

async function getAppointmentPhotoUploadSignature(): Promise<UploadSignature> {
  return apiFetch<UploadSignature>('/uploads/appointment-photo-signature')
}

async function getNoteAttachmentUploadSignature(): Promise<UploadSignature> {
  return apiFetch<UploadSignature>('/uploads/note-attachment-signature')
}

async function getFlashPieceUploadSignature(): Promise<UploadSignature> {
  return apiFetch<UploadSignature>('/uploads/flash-piece-signature')
}

async function uploadWithSignature(file: File, signature: UploadSignature): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('api_key', signature.apiKey)
  formData.append('timestamp', String(signature.timestamp))
  formData.append('signature', signature.signature)
  formData.append('folder', signature.folder)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ?? 'Image upload failed')
  }

  const data = await response.json()
  return data.secure_url as string
}

export async function uploadImageToCloudinary(file: File): Promise<string> {
  return uploadWithSignature(file, await getUploadSignature())
}

export async function uploadPortfolioImage(file: File): Promise<string> {
  return uploadWithSignature(file, await getPortfolioUploadSignature())
}

export async function uploadAppointmentPhoto(file: File): Promise<string> {
  return uploadWithSignature(file, await getAppointmentPhotoUploadSignature())
}

export async function uploadFlashPieceImage(file: File): Promise<string> {
  return uploadWithSignature(file, await getFlashPieceUploadSignature())
}

export interface NoteAttachment {
  url: string
  filename: string
  mimeType: string
}

// Cloudinary's auto/upload endpoint, not image/upload -- note attachments
// can be any file type (PDFs, docs, etc.), unlike every other upload in
// this app so far. No signed param changes: resource_type is only ever
// part of the endpoint URL, not a signed field, so the same folder+
// timestamp signature works unchanged. filename/mimeType come straight
// off the browser File object, since Cloudinary's own response for a
// non-image asset doesn't carry a human-readable original filename.
async function uploadRawWithSignature(file: File, signature: UploadSignature): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('api_key', signature.apiKey)
  formData.append('timestamp', String(signature.timestamp))
  formData.append('signature', signature.signature)
  formData.append('folder', signature.folder)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/auto/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ?? 'File upload failed')
  }

  const data = await response.json()
  return data.secure_url as string
}

export async function uploadNoteAttachment(file: File): Promise<NoteAttachment> {
  const url = await uploadRawWithSignature(file, await getNoteAttachmentUploadSignature())
  return { url, filename: file.name, mimeType: file.type }
}
