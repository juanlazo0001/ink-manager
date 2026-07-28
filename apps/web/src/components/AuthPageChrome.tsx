import type { ReactNode } from 'react'
import loginBackground from '../assets/login-background-no-artist.png'

// Shared background/overlay/rings/card chrome for every "fixed platform
// identity" auth page -- Login.tsx plus the new account-lifecycle public
// pages (invite accept, forgot/reset password, confirm email change).
// Deliberately factored out of Login.tsx rather than duplicated into it --
// that page has been hand-tuned live (background variant, overlay,
// spacing) across several rounds this session, so this component mirrors
// its CURRENT exact structure/classes without touching that file at all,
// closing off any risk of clobbering in-progress design work there. Same
// reasoning as Login.tsx's own comment: NOT themed by the per-studio
// preset system (lib/themePresets.ts) -- every color/font/radius here is
// a literal .login-*/.hero-shade/.rings class in index.css, not a
// swappable --color-*/--font-* token, since these pages are about the Ink
// Manager platform account itself, not any one studio's branding.
export default function AuthPageChrome({ children }: { children: ReactNode }) {
  return (
    <div className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <img
        src={loginBackground}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="hero-shade" aria-hidden="true" />
      <div className="rings" aria-hidden="true">
        <i />
        <i />
        <i />
        <s />
      </div>

      {children}
    </div>
  )
}
