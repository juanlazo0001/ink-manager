import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { API_URL } from './api';

/**
 * Signed PDFs — deposit forms and waivers.
 *
 * ─── THE MECHANISM, read off apps/api ───────────────────────────────
 *
 *   GET /deposit-forms/:id/pdf     Content-Type: application/pdf
 *   GET /waivers/:id/pdf           Content-Disposition: attachment; filename=…
 *
 * Both are plain authenticated GETs that reply with the PDF bytes in the
 * body — no signed URL, no redirect, no separate storage host, Bearer
 * token like every other call. Web's `downloadFile` does exactly this and
 * hands the blob to the browser. The two routes are identical in shape,
 * so one function covers both.
 *
 * ─── WHY A SHARE SHEET, NOT A "DOWNLOAD" ────────────────────────────
 *
 * A phone has no visible downloads folder to put this in. The native
 * idiom is: write the bytes into the app's own cache, then hand the file
 * to the system share sheet, where the person picks Files, Mail, AirDrop
 * or whatever they meant by "download". Anything else leaves a file
 * nobody can reach.
 *
 * The cache directory is the right home: the OS may reclaim it, which is
 * correct for a document the server can always re-issue.
 *
 * ─── ON expo-file-system 19'S API ───────────────────────────────────
 *
 * SDK 54 ships the `File`/`Paths` API; the old `downloadAsync` +
 * `cacheDirectory` pair now lives behind `expo-file-system/legacy`. The
 * modern one is the better fit here for a specific reason:
 * `File.downloadFileAsync` REJECTS on a non-2xx and writes no file. The
 * legacy call resolved for any status, so a 403 would have written the
 * error body to disk and opened a share sheet offering a "PDF"
 * containing the word "Forbidden" — a guard this no longer has to
 * hand-roll.
 *
 * The rejection's message is the module's own, read off
 * `ios/FileSystemModule.swift`:
 *
 *     UnableToDownloadException("response has status \(statusCode)")
 *
 * — which is the only place the status survives, hence the parse below
 * rather than a status field that does not exist.
 *
 * ─── WHAT THE ROUTES ACTUALLY RETURN ────────────────────────────────
 *
 * Exercised against the dev API on both kinds of document: 200 with
 * `Content-Type: application/pdf` and ~100KB of real bytes, 401 with no
 * token, 404 for an id that is not there.
 */

/** "response has status 403" -> 403. Null when the failure was not an HTTP one. */
function statusOf(err: unknown): number | null {
  const message = err instanceof Error ? err.message : '';
  const match = /status (\d{3})/.exec(message);
  return match ? Number(match[1]) : null;
}
export interface DocumentRef {
  kind: 'deposit-forms' | 'waivers';
  id: string;
  /** What the person sees in the share sheet. */
  filename: string;
}

export async function shareDocument(token: string, doc: DocumentRef): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  const url = `${API_URL}/${doc.kind}/${encodeURIComponent(doc.id)}/pdf`;
  const destination = new FsFile(Paths.cache, doc.filename);

  // Re-issuing over a stale copy of the same document, rather than
  // failing or silently sharing yesterday's version.
  if (destination.exists) destination.delete();

  // Not annotated on purpose: expo-file-system 19 declares `File` twice
  // — once in `FileSystem.d.ts` (the class you construct) and once in
  // `ExpoFileSystem.types.d.ts` (what the static returns) — and the two
  // are not assignable to each other. Inference takes the right one.
  let uri: string;
  try {
    const downloaded = await FsFile.downloadFileAsync(url, destination, {
      headers: { Authorization: `Bearer ${token}` },
    });
    uri = downloaded.uri;
  } catch (err) {
    // Turn the statuses that mean something specific into sentences a
    // person can act on. Everything else — no network, a 500, a disk
    // failure — is one honest sentence rather than a guess.
    switch (statusOf(err)) {
      case 401:
        throw new Error('Your session has expired. Sign in again to download this.');
      case 403:
        throw new Error("You don't have permission to download this document.");
      case 404:
        throw new Error('That document is no longer available.');
      default:
        throw new Error('The document could not be downloaded.');
    }
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: doc.filename,
  });
}
