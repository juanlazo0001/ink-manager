// Payment Received page refinements: a single "open in maps" link that
// targets each platform's own native map experience rather than always
// falling back to a generic web page. apple.com/maps.apple.com only ever
// opens the Apple Maps app (or its own web fallback) -- on Android it's
// just another website, never Google Maps -- so a single hardcoded URL
// can't satisfy both platforms; this picks the URL per platform instead.
//
// iOS: maps.apple.com is Apple's own registered universal link -- Safari
// (and any iOS browser) opens the Apple Maps app directly if installed,
// falling back to Apple's own maps.apple.com web view otherwise. Detected
// via the User-Agent string (iPhone/iPod always include this; classic
// iPad detection also needs the MacIntel + multi-touch fallback, since
// iPadOS 13+ reports as desktop Safari in its User-Agent by default).
//
// Everything else (Android, desktop, unknown): google.com/maps/search is
// Google's own registered Android App Link -- opens the Google Maps app
// directly if installed, falling back to the Google Maps website
// otherwise. Also a perfectly good universal fallback for desktop/other
// browsers with no native map app at all.
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPod|iPad/.test(ua)) return true
  // iPadOS 13+ desktop-class User-Agent workaround.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function buildMapsUrl(address: string): string {
  const encoded = encodeURIComponent(address)
  return isIOS() ? `https://maps.apple.com/?q=${encoded}` : `https://www.google.com/maps/search/?api=1&query=${encoded}`
}
