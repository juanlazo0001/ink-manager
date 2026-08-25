/**
 * `qrcode`'s deep entry point, typed to what this app uses.
 *
 * `@types/qrcode` describes the package's public surface — `toDataURL`,
 * `toCanvas`, `toString` — all of which need a canvas or a Node stream.
 * The matrix builder underneath them is pure JavaScript and is the only
 * part a React Native renderer wants, but it has no published types, so
 * this declares the one function actually imported rather than letting it
 * fall through to `any`.
 */
declare module 'qrcode/lib/core/qrcode' {
  export interface QrCodeMatrix {
    modules: {
      /** Modules per side, including the quiet-zone-free code itself. */
      size: number;
      /** One byte per module, row-major; non-zero means dark. */
      data: Uint8Array;
    };
  }

  /**
   * A NAMED export on a CommonJS object with no `__esModule` flag — a
   * default import would bind the module object, not this function, and
   * fail only at runtime. Declared named so the compiler enforces it.
   */
  export function create(
    data: string,
    options?: {
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      version?: number;
      maskPattern?: number;
    },
  ): QrCodeMatrix;
}
