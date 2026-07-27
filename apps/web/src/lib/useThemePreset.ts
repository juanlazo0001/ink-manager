import { useSyncExternalStore } from 'react'
import { getThemePresetInfo, getThemePresetSnapshot, subscribeThemePreset, type ThemePresetInfo } from './themePresets'

// Reactive read of the currently active theme preset -- for the small set
// of components whose actual DOM structure/typography differs between
// preset "shapes" (Widget, Modal, DetailField, StatusPill, InquiryPipeline,
// Sidebar, TopBar, ArtistAvatar, Dashboard's CardShell -- see REPORT.md's
// "Dual themes" entry for the full pure-style-vs-structural investigation).
// Works identically in the authenticated app shell (ThemeApplier calls
// applyThemePreset once /studio-settings resolves) and on every public
// token page (each applies its own fetched preset the same way) -- both
// paths go through the same applyThemePreset function, which is the only
// thing this hook subscribes to.
export function useThemePreset(): ThemePresetInfo {
  const key = useSyncExternalStore(subscribeThemePreset, getThemePresetSnapshot, getThemePresetSnapshot)
  return getThemePresetInfo(key)
}
