import type { Appearance } from '@stripe/stripe-js'

// Embedded payments migration: the Payment Element's own Appearance API
// config, matching the fixed Editorial Gold platform palette (index.css's
// .login-shell tokens) rather than any one studio's theme -- every
// embedded payment page (deposit, flash prepayment, session checkout) is
// wrapped in login-shell for the same "platform's own page, never studio-
// themed" reason the artist public page is, so the Payment Element itself
// needs to match that same fixed palette, not vary per studio. One shared
// definition, reused by every page that mounts a Payment Element, rather
// than three copies that could drift.
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
    borderRadius: '10px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: '1px solid rgba(201, 154, 91, 0.18)',
      backgroundColor: '#120f0b',
    },
    '.Input:focus': {
      border: '1px solid #c99a5b',
      boxShadow: '0 0 0 1px #c99a5b',
    },
    '.Label': {
      color: '#c7bea9',
    },
    '.Tab': {
      border: '1px solid rgba(201, 154, 91, 0.18)',
      backgroundColor: '#120f0b',
    },
    '.Tab--selected': {
      border: '1px solid #c99a5b',
      backgroundColor: '#171310',
    },
  },
}
