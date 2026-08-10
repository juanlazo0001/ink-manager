import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './locales';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Mounted once around each of the six public flow pages individually
// (not the whole app -- the staff-facing app stays English-only for
// v1), so each page controls its own initialLocale from whatever it
// already knows server-side by the time it renders (a verify response's
// own locale-aware field, or Client.preferredLocale once the
// persistence layer -- a later part -- reads it back). Falls back to
// DEFAULT_LOCALE for anything invalid/unrecognized rather than throwing
// -- a stale/garbage value here should never take down the page.
export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: string | null }) {
  const [locale, setLocale] = useState<Locale>(isSupportedLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE);
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}

// For the rare shared component (PublicPageFooter) mounted both inside a
// LocaleProvider (the six/eight i18n'd public flows) AND outside one
// (GiftCardResponse.tsx, still English-only for v1) -- returns null
// rather than throwing when no provider is present, so that one caller
// can render its own English-only fallback instead of crashing.
export function useLocaleSafe(): LocaleContextValue | null {
  return useContext(LocaleContext);
}
