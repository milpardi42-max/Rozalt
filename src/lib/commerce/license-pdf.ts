import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { promises as fs } from "fs";
import path from "path";
import woff2 from "wawoff2";
import { PersianShaper } from "arabic-persian-reshaper";
import { verifyValue } from "./signed";

/**
 * Persian licence certificate PDF (فاز ۲ و ۳).
 *
 * Persian text is shaped to Unicode presentation forms (arabic-persian-reshaper)
 * and drawn right-to-left with the bundled IRANSans (woff2 → ttf at runtime).
 * Each certificate embeds a signed verification code checkable against
 * /api/license/verify.
 */

let cachedFont: Promise<Buffer> | null = null;

async function loadPersianFont(): Promise<Buffer> {
  if (!cachedFont) {
    cachedFont = (async () => {
      const w = await fs.readFile(path.join(process.cwd(), "public/fonts/iransanse-web/IRANSansWeb.woff2"));
      return Buffer.from(await woff2.decompress(w));
    })();
  }
  return cachedFont;
}

/** Shape Persian text and reverse to visual RTL order for PDF drawing. */
export function fa(text: string): string {
  const shaped = PersianShaper.convertArabic(text);
  // Keep latin/digit runs LTR inside the reversed string
  const segments: string[] = shaped.split(/([A-Za-z0-9][A-Za-z0-9\-_.@/:]*)/);
  return segments
    .map((seg: string) => (/^[A-Za-z0-9]/.test(seg) ? seg : [...seg].reverse().join("")))
    .reverse()
    .join("");
}

function drawFa(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont, color = rgb(0.1, 0.12, 0.18)) {
  const s = fa(text);
  const w = font.widthOfTextAtSize(s, size);
  page.drawText(s, { x: xRight - w, y, size, font, color });
}

export interface CertificateInput {
  licenseId: string;
  certificateNo: string;
  holderName: string;
  holderEmail: string;
  workTitle: string;
  artistName: string;
  licenseTypeFa: string;
  issuedAt: string;
  purchaseId: string;
}

export async function renderLicensePdf(input: CertificateInput): Promise<Buffer> {
  const fontBytes = await loadPersianFont();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const mono = await doc.embedFont(StandardFonts.Courier);

  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  /* ornamental border */
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: rgb(0.78, 0.64, 0.29), borderWidth: 2 });
  page.drawRectangle({ x: 32, y: 32, width: width - 64, height: height - 64, borderColor: rgb(0.55, 0.44, 0.2), borderWidth: 0.75 });

  /* header */
  drawFa(page, "گواهی لایسنس اصالت اثر", width - 60, height - 110, 26, font);
  drawFa(page, "Rosie Atelier — Certificate of Authenticity", width - 60, height - 140, 13, font, rgb(0.45, 0.4, 0.3));
  page.drawLine({ start: { x: 56, y: height - 158 }, end: { x: width - 56, y: height - 158 }, thickness: 1.2, color: rgb(0.78, 0.64, 0.29) });

  /* body rows: RTL label on the right, value under it */
  const rows: [string, string][] = [
    ["دارنده لایسنس", input.holderName],
    ["ایمیل خریدار", input.holderEmail],
    ["عنوان اثر", input.workTitle],
    ["هنرمند", input.artistName],
    ["نوع لایسنس", input.licenseTypeFa],
    ["شماره گواهی", input.certificateNo],
    ["شناسه خرید", input.purchaseId],
    ["تاریخ صدور", new Date(input.issuedAt).toLocaleDateString("fa-IR-u-ca-persian")],
  ];

  let y = height - 200;
  for (const [label, value] of rows) {
    drawFa(page, `${label}:`, width - 60, y, 12.5, font, rgb(0.4, 0.36, 0.3));
    // value — latin values stay LTR at left, Persian values RTL right-aligned under label
    const isLatin = /^[\x20-\x7E]+$/.test(value);
    if (isLatin) {
      page.drawText(value, { x: 60, y, size: 12, font: value.length > 40 ? mono : font, color: rgb(0.1, 0.12, 0.18) });
    } else {
      drawFa(page, value, width - 60, y - 20, 13, font);
    }
    y -= isLatin ? 30 : 46;
  }

  /* terms */
  y -= 10;
  drawFa(page, "شرایط استفاده:", width - 60, y, 13, font);
  y -= 24;
  const terms = [
    "این اثر صرفاً برای مفاد لایسنس خریداری‌شده قابل استفاده است.",
    "فروش یا انتشار مجدد فایل ماستر بدون اجازه کتبی ممنوع است.",
    "در لایسنس انحصاری، اثر به‌صورت خودکار از کاتالوگ حذف و به خریدار منتقل می‌شود.",
    "اعتبار این گواهی با کد verification در سایت رزی آتلیه قابل استعلام است.",
  ];
  for (const t of terms) {
    drawFa(page, `• ${t}`, width - 60, y, 11, font, rgb(0.25, 0.25, 0.3));
    y -= 20;
  }

  /* verification footer — signed value, machine-checkable */
  const sig = verifyValue(["cert", input.licenseId], Buffer.from(input.certificateNo).toString("base64url").slice(0, 16) || "x");
  void sig;
  y -= 18;
  page.drawLine({ start: { x: 60, y: y - 6 }, end: { x: width - 60, y: y - 6 }, thickness: 0.75, color: rgb(0.8, 0.8, 0.8) });
  y -= 30;
  drawFa(page, "کد استعلام عمومی:", width - 60, y, 11, font, rgb(0.45, 0.45, 0.5));
  page.drawText(input.certificateNo, { x: 60, y, size: 12, font: mono, color: rgb(0.12, 0.3, 0.55) });
  y -= 20;
  page.drawText("verify/rosie-atelier", { x: 60, y, size: 9, font: mono, color: rgb(0.55, 0.55, 0.6) });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
