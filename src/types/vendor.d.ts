declare module "wawoff2" {
  /** Decompress a WOFF2 font buffer to a TTF/OTF buffer. */
  export function decompress(data: Uint8Array | ArrayBuffer | Buffer): Promise<Uint8Array>;
  /** Compress a TTF/OTF buffer to WOFF2. */
  export function compress(data: Uint8Array | ArrayBuffer | Buffer): Promise<Uint8Array>;
}

declare module "arabic-persian-reshaper" {
  /**
   * Reshape Persian/Arabic text to Unicode presentation forms so that
   * naive LTR renderers (PDF drawText, canvas fillText, …) display the
   * correct contextual letter forms.
   */
  export const PersianShaper: {
    convertArabic(text: string): string;
  };
  export const ArabicShaper: {
    convertArabic(text: string): string;
  };
}
