// Package BK: the commit this bundle was built from, injected by Vite's
// `define` (see apps/web/vite.config.ts). Reading it through one module means
// the globals are declared once and every consumer gets a plain string.
//
// The point of this file is the deploy question: "is production running the
// code I think it is?" Before this, answering that meant downloading the
// production bundle and grepping it for strings that only exist after a
// particular commit. Now it is printed on the crash screen and attached to
// every client error report.

declare const __APP_COMMIT__: string
declare const __APP_BUILT_AT__: string

// `typeof` guards rather than a bare read: a consumer imported into a test
// or a tool that does not go through Vite would otherwise throw a
// ReferenceError on an undeclared global.
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown'
export const APP_BUILT_AT: string = typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : 'unknown'
