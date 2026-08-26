import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';

/**
 * Saving a message's image to the phone's photo library.
 *
 * ─── IT IS TWO STEPS, NOT ONE ───────────────────────────────────────
 *
 * `MediaLibrary.saveToLibraryAsync` takes a LOCAL file path. Chat images
 * live on Cloudinary, so the bytes have to come down first — the same
 * `File.downloadFileAsync` the deposit/waiver PDFs use, and for the same
 * reason: it rejects on a non-2xx and writes nothing, so a dead URL
 * cannot end up saved to someone's camera roll as a broken file.
 *
 * ─── PERMISSION ─────────────────────────────────────────────────────
 *
 * Uses `requestPermissionsAsync(true)` — the `writeOnly` argument. Adding
 * to the library needs only add-access, and asking for full read access
 * to someone's entire photo library in order to save one picture is a
 * bigger ask than the feature deserves. iOS shows a smaller prompt for it.
 *
 * A denial is not an error state to shout about: it returns a sentence
 * the caller can show once and move on.
 *
 * ─── EXPO GO ────────────────────────────────────────────────────────
 *
 * `expo-media-library` is bundled with SDK 54 (`~18.2.1` in
 * `expo/bundledNativeModules.json`), so this works in the App Store build
 * of Expo Go — checked before the dependency was added, because a module
 * that is not bundled would make the app unopenable on the owner's phone.
 */
export type SaveResult = { ok: true } | { ok: false; message: string };

export async function saveImageToLibrary(url: string): Promise<SaveResult> {
  let permission = await MediaLibrary.getPermissionsAsync(true);
  if (!permission.granted && permission.canAskAgain) {
    permission = await MediaLibrary.requestPermissionsAsync(true);
  }
  if (!permission.granted) {
    return {
      ok: false,
      message: permission.canAskAgain
        ? 'Saving needs permission to add to your photos.'
        : 'Photos access is off for this app. Turn it on in Settings to save images.',
    };
  }

  // A stable, boring filename: the library renames it anyway, and a name
  // derived from the URL can carry query strings and other junk.
  const name = `ink-manager-${Date.now()}.${extensionFor(url)}`;
  const destination = new File(Paths.cache, name);
  if (destination.exists) destination.delete();

  try {
    const downloaded = await File.downloadFileAsync(url, destination);
    await MediaLibrary.saveToLibraryAsync(downloaded.uri);
  } catch {
    return { ok: false, message: 'That image could not be saved.' };
  } finally {
    // The camera roll has its own copy now; the cache one is litter.
    try {
      if (destination.exists) destination.delete();
    } catch {
      // The OS reclaims the cache directory on its own — never worth
      // failing a save that already succeeded.
    }
  }

  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return { ok: true };
}

/** Cloudinary URLs often carry no extension; jpg is the safe default. */
function extensionFor(url: string): string {
  const match = /\.(jpe?g|png|gif|webp|heic)(?:\?|$)/i.exec(url);
  return match ? match[1].toLowerCase() : 'jpg';
}
