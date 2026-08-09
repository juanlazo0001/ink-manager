import type { Appearance, CssFontSource, CustomFontSource } from '@stripe/stripe-js'
import outfitRegularWoff2 from '@fontsource/outfit/files/outfit-latin-400-normal.woff2?url'

// Embedded payments migration: the Payment Element's own Appearance API
// config, matching the fixed Editorial Gold platform palette (index.css's
// .login-shell tokens) rather than any one studio's theme -- every
// embedded payment page (deposit, flash prepayment, session checkout) is
// wrapped in login-shell for the same "platform's own page, never studio-
// themed" reason the artist public page is, so the Payment Element itself
// needs to match that same fixed palette, not vary per studio. One shared
// definition, reused by every page that mounts a Payment Element, rather
// than three copies that could drift.
//
// Restyle pass: inputs/tabs now match .login-input's own values exactly
// (index.css) -- --color-input-bg (#0f0e0d) / --color-input-border
// (#252322), the SAME neutral, deliberately non-gold-tinted pair every
// other login-shell page already uses (Sign In, Signup, Reset Password,
// Invite Accept), rather than the generic --color-border, which resolves
// gold-tinted under editorial-gold (correct for studio-panel chrome, wrong
// for a field at rest). Gold stays reserved for :focus/--selected only,
// matching .login-input:focus's own border+box-shadow treatment and the
// app-wide "gold = action" rule. borderRadius matches .login-input's own
// literal 5px, not the card's --radius-card.
export const EDITORIAL_GOLD_STRIPE_APPEARANCE: Appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#c99a5b',
    colorBackground: '#171310',
    colorText: '#f2ece0',
    colorTextSecondary: '#c7bea9',
    colorTextPlaceholder: '#9b927f',
    colorDanger: '#e5484d',
    fontFamily: 'Outfit, ui-sans-serif, system-ui, sans-serif',
    borderRadius: '5px',
    spacingUnit: '4px',
    labelFontSize: '14px',
    labelFontWeight: '500',
  },
  rules: {
    '.Input': {
      border: '1px solid #252322',
      backgroundColor: '#0f0e0d',
    },
    '.Input:focus': {
      border: '1px solid #c99a5b',
      boxShadow: '0 0 0 1px #c99a5b',
    },
    '.Label': {
      color: '#c7bea9',
    },
    '.Tab': {
      border: '1px solid #252322',
      backgroundColor: '#171310',
    },
    '.Tab--selected': {
      border: '1px solid #c99a5b',
      backgroundColor: '#171310',
    },
  },
}

// The Payment Element renders inside a cross-origin iframe -- it does NOT
// inherit @font-face rules from the parent document, so setting
// `fontFamily: 'Outfit, ...'` above alone silently falls back to the next
// stack entry (ui-sans-serif/system-ui) with no error. This is Stripe's
// own documented mechanism for loading a self-hosted font INTO that
// iframe (stripe.elements({ fonts: [...] }), a sibling of `appearance`,
// not nested inside it). Vite's `?url` suffix resolves the already-
// self-hosted @fontsource/outfit file (same package index.css imports)
// to its real built asset URL, so this never hand-hardcodes a path that
// could drift from the actual build output.
export const EDITORIAL_GOLD_STRIPE_FONTS: Array<CssFontSource | CustomFontSource> = [
  {
    family: 'Outfit',
    src: `url(${outfitRegularWoff2}) format('woff2')`,
    weight: '400',
    style: 'normal',
  },
]
