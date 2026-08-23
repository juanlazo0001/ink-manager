import { useCallback, useRef, useState } from 'react';

import { apiFetch } from '@/lib/api';
import {
  SIGNATURE_ENDPOINTS,
  uploadToCloudinaryWithProgress,
  type PickedImage,
  type UploadSignature,
} from '@/lib/upload';

/**
 * One image on its way into a message.
 *
 * `localUri` is kept for every state so the thumbnail is visible from the
 * instant it is picked -- waiting for Cloudinary to answer before showing
 * anything would make attaching feel broken on a slow connection.
 */
export interface PendingAttachment {
  id: string;
  localUri: string;
  status: 'uploading' | 'done' | 'failed';
  /** 0..1, only meaningful while uploading. */
  progress: number;
  /** The Cloudinary URL, once uploaded. This is what gets sent. */
  url?: string;
  error?: string;
}

/**
 * Attachment uploads for the composer.
 *
 * Uploads start the moment an image is picked, not on send: by the time
 * the person has typed a caption the upload is usually already done, and
 * a failure surfaces while they can still do something about it rather
 * than at the moment they hit send.
 *
 * A fresh signature is fetched per upload, matching apps/web's own
 * reasoning -- a composer left open past Cloudinary's freshness window
 * would otherwise fail with a stale signature.
 */
export function useAttachments(token: string | null) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const nextId = useRef(0);
  // Keyed by attachment id so removing one mid-flight can abort just it.
  const cancels = useRef<Record<string, () => void>>({});
  // The picked image behind each entry, so a retry re-uploads the same
  // file instead of making the person choose it again.
  const images = useRef<Record<string, PickedImage>>({});

  const patch = useCallback((id: string, next: Partial<PendingAttachment>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const start = useCallback(
    async (id: string, image: PickedImage) => {
      if (!token) {
        patch(id, { status: 'failed', error: 'Signed out.' });
        return;
      }
      patch(id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const signature = await apiFetch<UploadSignature>(SIGNATURE_ENDPOINTS.chat, { token });
        const { promise, cancel } = uploadToCloudinaryWithProgress(signature, image, (fraction) =>
          patch(id, { progress: fraction }),
        );
        cancels.current[id] = cancel;
        const url = await promise;
        delete cancels.current[id];
        patch(id, { status: 'done', progress: 1, url });
      } catch (err) {
        delete cancels.current[id];
        patch(id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Upload failed.',
        });
      }
    },
    [token, patch],
  );

  const add = useCallback(
    (image: PickedImage) => {
      const id = `att-${nextId.current++}`;
      setItems((current) => [
        ...current,
        { id, localUri: image.uri, status: 'uploading', progress: 0 },
      ]);
      images.current[id] = image;
      void start(id, image);
    },
    [start],
  );

  const retry = useCallback(
    (id: string) => {
      const image = images.current[id];
      if (image) void start(id, image);
    },
    [start],
  );

  const remove = useCallback((id: string) => {
    cancels.current[id]?.();
    delete cancels.current[id];
    delete images.current[id];
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const cancel of Object.values(cancels.current)) cancel();
    cancels.current = {};
    images.current = {};
    setItems([]);
  }, []);

  return {
    items,
    add,
    retry,
    remove,
    clear,
    /** Only the finished ones — this is what a send may reference. */
    uploadedUrls: items.filter((item) => item.status === 'done' && item.url).map((item) => item.url!),
    /** True while anything is still going up; send waits for this. */
    busy: items.some((item) => item.status === 'uploading'),
    hasFailed: items.some((item) => item.status === 'failed'),
  };
}
