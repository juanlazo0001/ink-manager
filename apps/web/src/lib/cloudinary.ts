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

export async function uploadImageToCloudinary(file: File): Promise<string> {
  const signature = await getUploadSignature()

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
