import * as ImagePicker from 'expo-image-picker';

import { apiFetch } from './api';

/**
 * Image upload, reusing the API's EXISTING signed-upload surface — no new
 * endpoints. There are two genuinely different mechanisms in this
 * product, and conflating them would break one of them:
 *
 *   Cloudinary direct upload    portfolio images, flash pieces
 *     GET /uploads/*-signature → POST straight to Cloudinary → keep the
 *     returned secure_url → save that URL on the record.
 *
 *   Base64 data URL on the row  avatars (and studio logos)
 *     No Cloudinary at all. PATCH /users/me takes `avatarUrl` as a
 *     `data:image/...` string, capped at 5 MB of SOURCE image
 *     (MAX_IMAGE_SOURCE_MB in apps/api/src/lib/images.ts). Chosen there
 *     deliberately rather than adding file infra for small images.
 *
 * Signatures are fetched fresh per upload, matching apps/web's own
 * comment: a form left open past Cloudinary's freshness window would
 * otherwise fail with a stale signature.
 */

export interface UploadSignature {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
}

/** The signature endpoints this app is allowed to use, by purpose. */
export const SIGNATURE_ENDPOINTS = {
  portfolio: '/uploads/portfolio-signature',
  flash: '/uploads/flash-piece-signature',
  // Chat attachments. apps/web's composer uploads through
  // `uploadImageToCloudinary`, which is this same generic
  // `/uploads/signature` (the inquiry folder) -- so mobile reuses the
  // endpoint web already uses for exactly this, rather than adding one.
  chat: '/uploads/signature',
} as const;

export type UploadPurpose = keyof typeof SIGNATURE_ENDPOINTS;

export type UploadStatus =
  | { state: 'idle' }
  | { state: 'picking' }
  | { state: 'uploading' }
  | { state: 'done'; url: string }
  | { state: 'failed'; message: string };

/** Asks for camera access. Returns false when the person says no. */
export async function ensureCameraPermission(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await ImagePicker.requestCameraPermissionsAsync();
  return asked.granted;
}

/** Asks for library access. Returns false when the person says no. */
export async function ensureLibraryPermission(): Promise<boolean> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return asked.granted;
}

export interface PickedImage {
  uri: string;
  mimeType: string;
  fileName: string;
  /** Present only when `base64` was requested. */
  base64?: string;
}

/**
 * Opens the library. `forAvatar` switches on square cropping and base64,
 * because the avatar path needs the bytes inline rather than a file to
 * post to Cloudinary.
 *
 * `quality` is deliberately below 1: an unmodified modern phone photo is
 * several MB, which for the avatar path would exceed the API's 5 MB
 * source cap before the person has done anything wrong.
 */
export async function pickImage(options: { forAvatar?: boolean } = {}): Promise<PickedImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: !!options.forAvatar,
    aspect: options.forAvatar ? [1, 1] : undefined,
    quality: options.forAvatar ? 0.7 : 0.85,
    base64: !!options.forAvatar,
  });

  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? `upload-${Date.now()}.jpg`,
    base64: asset.base64 ?? undefined,
  };
}

/**
 * Camera capture. Same shape as `pickImage`, so callers can treat the two
 * sources identically -- expo-image-picker returns the same asset type
 * from both, which is why adding capture costs almost nothing here.
 */
export async function captureImage(): Promise<PickedImage | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? `capture-${Date.now()}.jpg`,
    base64: asset.base64 ?? undefined,
  };
}

/**
 * The same Cloudinary upload as `uploadToCloudinary`, but reporting
 * progress.
 *
 * XMLHttpRequest rather than `fetch`: RN's fetch exposes no upload
 * progress at all, and a chat attachment is the one upload in this app
 * where the person is waiting on it before they can send. React Native
 * implements `xhr.upload.onprogress`, so this is a platform feature, not
 * a polyfill.
 *
 * Returns the same `secure_url` string, so callers are interchangeable.
 */
export function uploadToCloudinaryWithProgress(
  signature: UploadSignature,
  image: PickedImage,
  onProgress: (fraction: number) => void,
): { promise: Promise<string>; cancel: () => void } {
  const form = new FormData();
  form.append('file', { uri: image.uri, name: image.fileName, type: image.mimeType } as unknown as Blob);
  form.append('api_key', signature.apiKey);
  form.append('timestamp', String(signature.timestamp));
  form.append('signature', signature.signature);
  form.append('folder', signature.folder);

  const xhr = new XMLHttpRequest();
  const promise = new Promise<string>((resolve, reject) => {
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((JSON.parse(xhr.responseText) as { secure_url: string }).secure_url);
        } catch {
          reject(new Error('Upload succeeded but the response could not be read.'));
        }
        return;
      }
      let message = 'Image upload failed.';
      try {
        message = (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        // Cloudinary answered with something that isn't JSON; keep the generic message.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Couldn't reach the image service. Check your connection."));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(form as unknown as Document);
  });

  return { promise, cancel: () => xhr.abort() };
}

/**
 * Cloudinary direct upload, byte-for-byte the same request apps/web
 * builds — same fields, same endpoint, same `secure_url` read back.
 *
 * React Native's FormData takes `{ uri, name, type }` rather than a File;
 * that is the only difference from web's version.
 */
export async function uploadToCloudinary(
  token: string,
  purpose: UploadPurpose,
  image: PickedImage,
): Promise<string> {
  const signature = await apiFetch<UploadSignature>(SIGNATURE_ENDPOINTS[purpose], { token });

  const form = new FormData();
  form.append('file', { uri: image.uri, name: image.fileName, type: image.mimeType } as unknown as Blob);
  form.append('api_key', signature.apiKey);
  form.append('timestamp', String(signature.timestamp));
  form.append('signature', signature.signature);
  form.append('folder', signature.folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'Image upload failed.');
  }

  const data = (await response.json()) as { secure_url: string };
  return data.secure_url;
}

/** Source-image ceiling the API enforces on avatars. */
export const MAX_AVATAR_SOURCE_MB = 5;

/**
 * Turns a picked image into the `data:image/...` string `PATCH /users/me`
 * expects, refusing anything the API would reject anyway.
 *
 * Checked here rather than left to the server so the message names the
 * limit in megabytes a person recognises, instead of surfacing a 400
 * after a slow upload.
 */
export function toAvatarDataUrl(image: PickedImage): string {
  if (!image.base64) {
    throw new Error('That image could not be read. Try another one.');
  }
  const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
  // Same arithmetic as the API's MAX_IMAGE_DATA_URL_LENGTH: base64
  // inflates by ~4/3, plus room for the prefix.
  const max = Math.ceil((MAX_AVATAR_SOURCE_MB * 1_000_000 * 4) / 3) + 100;
  if (dataUrl.length > max) {
    throw new Error(`That photo is too large. Please use an image under ${MAX_AVATAR_SOURCE_MB}MB.`);
  }
  return dataUrl;
}
