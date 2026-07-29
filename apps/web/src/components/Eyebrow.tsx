import type { ReactNode } from 'react'
import { useThemePreset } from '../lib/useThemePreset'

interface EyebrowProps {
  children: ReactNode
  // Secondary bit of context (a date range, "All-time", etc.) -- the
  // consistent place this session's own brief asked for, instead of a
  // loose floating grey span next to whatever title this sits above.
  meta?: ReactNode
  className?: string
}

// Editorial Gold's eyebrow label: small letterspaced uppercase text
// flanked by red "+" glyphs, mirroring the marketing site's own .kicker
// (marketing/index.html's reference CSS/copy -- "The Booking", "The Seven
// Phases", etc. above each section's headline). A real shared component
// rather than hardcoded once on Dashboard, so any other Editorial Gold
// page/card picks up the identical pattern by importing this.
//
// Renders as a plain caption under every other preset (checks
// useThemePreset() itself, same convention Dashboard's old inline
// isEditorial ternary used) -- callers use <Eyebrow> unconditionally,
// the theme branch lives here once instead of being repeated at every
// call site.
export default function Eyebrow({ children, meta, className }: EyebrowProps) {
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'

  if (!isEditorial) {
    return (
      <p className={['text-xs text-fg-muted', className].filter(Boolean).join(' ')}>
        {children}
        {meta ? <> · {meta}</> : null}
      </p>
    )
  }

  return (
    <p
      className={[
        'inline-flex flex-wrap items-center gap-3 font-jura text-[11px] font-semibold tracking-[0.34em] text-fg-muted uppercase',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="text-danger-strong text-[13px] tracking-normal" aria-hidden="true">
        +
      </span>
      {children}
      <span className="text-danger-strong text-[13px] tracking-normal" aria-hidden="true">
        +
      </span>
      {meta ? <span className="text-fg-muted/70 text-[11px] font-normal normal-case tracking-normal">{meta}</span> : null}
    </p>
  )
}
