import "server-only";
import sharp from "sharp";
import type { SeamlessReport } from "./types";

/**
 * Automatic seamless-tile detection (فاز ۳).
 *
 * Compares the left/right and top/bottom edge bands of a raster tile.
 * For a genuinely seamless tile the wrapped edges join without a visible
 * step, so the mean absolute difference of opposite edge pixels — after
 * normalising for overall image contrast — should be small.
 *
 *   score = 1 − min(1, mae / dynamicRange)   (averaged over both axes)
 *   seamless when score ≥ threshold (default 0.92)
 */

const BAND = 4;           // edge sample width in px
const DEFAULT_THRESHOLD = 0.92;

function bandMae(
  raw: Buffer, width: number, height: number, channels: number,
  axis: "v" | "h",
): { mae: number; range: number } {
  let sum = 0;
  let n = 0;
  let min = 255;
  let max = 0;

  const sample = (i: number) => {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
    return v;
  };

  if (axis === "v") {
    // left band vs right band (wrap-around)
    for (let y = 0; y < height; y += 2) {
      for (let c = 0; c < channels; c++) {
        const leftIdx = (y * width + 0) * channels + c;
        const rightIdx = (y * width + (width - 1)) * channels + c;
        const a = sample(leftIdx);
        const b = raw[rightIdx];
        if (b < min) min = b;
        if (b > max) max = b;
        sum += Math.abs(a - b);
        n += 1;
      }
      // one band inward for tolerance
      for (let c = 0; c < channels; c++) {
        const a = sample((y * width + BAND) * channels + c);
        const b = raw[(y * width + (width - 1 - BAND)) * channels + c];
        if (b < min) min = b;
        if (b > max) max = b;
        sum += Math.abs(a - b);
        n += 1;
      }
    }
  } else {
    // top band vs bottom band
    for (let x = 0; x < width; x += 2) {
      for (let c = 0; c < channels; c++) {
        const topIdx = x * channels + c;
        const botIdx = ((height - 1) * width + x) * channels + c;
        const a = sample(topIdx);
        const b = raw[botIdx];
        if (b < min) min = b;
        if (b > max) max = b;
        sum += Math.abs(a - b);
        n += 1;
      }
      for (let c = 0; c < channels; c++) {
        const a = sample((BAND * width + x) * channels + c);
        const b = raw[((height - 1 - BAND) * width + x) * channels + c];
        if (b < min) min = b;
        if (b > max) max = b;
        sum += Math.abs(a - b);
        n += 1;
      }
    }
  }

  return { mae: n ? sum / n : 255, range: Math.max(1, max - min) };
}

export async function analyzeSeamless(
  sourcePath: string,
  ext: string,
  threshold = DEFAULT_THRESHOLD,
): Promise<SeamlessReport | null> {
  const raster = ["jpg", "jpeg", "png", "webp", "avif", "tiff"];
  if (!raster.includes(ext.toLowerCase())) return null;

  try {
    const { data, info } = await sharp(sourcePath, { failOn: "none" })
      .rotate() // normalise EXIF orientation before edge sampling
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const v = bandMae(data, info.width, info.height, info.channels, "v");
    const h = bandMae(data, info.width, info.height, info.channels, "h");

    const scoreV = 1 - Math.min(1, v.mae / v.range);
    const scoreH = 1 - Math.min(1, h.mae / h.range);
    const score = Math.max(0, (scoreV + scoreH) / 2);

    return {
      score: Math.round(score * 1000) / 1000,
      seamless: score >= threshold,
      threshold,
      at: new Date().toISOString(),
    };
  } catch (e) {
    console.error("[seamless] analysis failed:", e);
    return null;
  }
}
