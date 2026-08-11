import { useLocale } from './LocaleContext';
import { SUPPORTED_LOCALES, LOCALE_LABELS } from './locales';

// Language becomes customer-specific: this is now the ONLY place a
// client explicitly states a language preference (every other public
// page resolves purely from Client.preferredLocale/Accept-Language,
// no picker at all). Mounted on IntakeForm.tsx (page chrome, always
// present) and FlashPublicGallery.tsx (only once a visitor opens a
// specific piece's request form -- not during anonymous gallery
// browsing). Compact on purpose -- a toggle, not a settings panel.
// Persistence happens at submission (there's no Client to attach a
// preference to until the request/inquiry creates one), wired in by
// each page's own submit body, not this component -- this stays
// presentation only.
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
