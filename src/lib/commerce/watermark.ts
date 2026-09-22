import "server-only";
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

/**
 * Automatic watermarking (فاز ۲).
 * Applies a tiled diagonal watermark to image masters and stores the result
 * next to the private file (never in /public). Non-image files (zip/psd/pdf)
 * are skipped — they are only delivered post-purchase, signed.
 */

const PREVIEW_MAX = 1600;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "avif", "tiff"]);

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

function watermarkSvg(width: number, height: number, label: string): Buffer {
  const stepX = 340;
  const stepY = 180;
  const tiles: string[] = [];
  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      tiles.push(
        `<text x="${x}" y="${y}" font-family="sans-serif" font-size="26" fill="rgba(255,255,255,0.55)" stroke="rgba(0,0,0,0.18)" stroke-width="0.6" transform="rotate(-28 ${x} ${y})">${label}</text>`,
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${tiles.join("")}</svg>`;
  return Buffer.from(svg);
}

/**
 * Build a watermarked, size-capped preview of an image master.
 * Returns the relative storage path of the preview, or null when the file
 * is not a raster image.
 */
export async function buildWatermarkedPreview(
  sourcePath: string,
  ext: string,
  label = "ROSIE ATELIER · رزی آتلیه",
): Promise<string | null> {
  if (!isImageExt(ext)) return null;

  try {
    const img = sharp(sourcePath, { failOn: "none" });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;

    const resized = await img
      .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    const { data, info } = resized;

    const overlay = await sharp(watermarkSvg(info.width, info.height, label))
      .png()
      .toBuffer();

    const previewPath = sourcePath.replace(/\.[^.]+$/, "") + ".preview.jpg";
    await sharp(data)
      .composite([{ input: overlay, gravity: "center" }])
      .jpeg({ quality: 84, mozjpeg: true })
      .toFile(previewPath);

    return previewPath;
  } catch (e) {
    console.error("[watermark] failed:", e);
    return null;
  }
}

/** Ensure the private directory exists. */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function privateMastersDir(): string {
  return path.join(process.cwd(), "data", "masters");
}
