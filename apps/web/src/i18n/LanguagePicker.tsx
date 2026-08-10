import { useLocale } from './LocaleContext';
import { SUPPORTED_LOCALES, LOCALE_LABELS } from './locales';

// Mounted in the header area of each of the six public flow pages,
// consistently placed near the studio name/logo each page already
// renders (per the Part 1 proposal's own placement decision). Compact
// on purpose -- a toggle, not a settings panel. Persistence (writing
// the choice onto Client.preferredLocale) is a separate concern wired
// in by each page's own onChange handler, not this component -- this
// is presentation only, so it stays reusable across pages with very
// different persistence endpoints.
export default function LanguagePicker({
  onChange,
  className = '',
}: {
  onChange?: (locale: (typeof SUPPORTED_LOCALES)[number]) => void;
  className?: string;
}) {
  const { locale, setLocale } = useLocale();

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface-inset p-0.5 text-xs ${className}`}>
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => {
            setLocale(code);
            onChange?.(code);
          }}
          aria-pressed={locale === code}
          className={`rounded-full px-2.5 py-1 font-medium transition ${
            locale === code ? 'bg-accent text-bg' : 'text-fg-secondary hover:text-fg'
          }`}
        >
          {LOCALE_LABELS[code]}
        </button>
      ))}
    </div>
  );
}
