import { useLocale } from './LocaleContext';
import { en } from './strings/en';
import { es } from './strings/es';
import { DEFAULT_LOCALE, type Locale } from './locales';

const DICTIONARIES: Record<Locale, typeof en> = { en, es };

// Every valid dot-path into `en`'s own shape, e.g. "deposit.loading" or
// "deposit.terms.agreedAge18" -- this is the actual compile-time
// enforcement that makes `t('some.made.up.key')` a type error rather
// than a silent runtime fallback. Derived from en.ts alone; es.ts (and
// any future locale) is guaranteed to have the identical set of paths
// by its own `es: typeof en` type annotation.
type DotPaths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
    }[keyof T & string];

export type TranslationKey = DotPaths<typeof en>;

type Vars = Record<string, string | number>;

function getByPath(obj: unknown, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function useTranslations() {
  const { locale } = useLocale();

  function t(key: TranslationKey, vars?: Vars): string {
    const dict = DICTIONARIES[locale];
    const fallbackDict = DICTIONARIES[DEFAULT_LOCALE];
    // A missing key at the CURRENT locale (shouldn't happen given
    // es.ts's own type-level parity check, but a defensive fallback
    // costs nothing) falls back to English, never to the raw key --
    // a client should never see a literal dot-path string on the page.
    const template = getByPath(dict, key) ?? getByPath(fallbackDict, key) ?? key;
    return interpolate(template, vars);
  }

  return { t, locale };
}
