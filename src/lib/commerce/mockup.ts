import "server-only";
import sharp from "sharp";

/**
 * Automatic mockup generator (فاز ۳).
 *
 * Renders the tile into three photorealistic-ish room mockups built
 * procedurally with sharp (no external assets):
 *
 *   1. framed  — artwork in a gallery frame on a warm wall
 *   2. pillow  — patterned cushion on a sofa strip
 *   3. wallpaper — full-wall tiling with baseboard + floor
 *
 * Returns PNG buffers; the caller persists them beside the private master.
 *
 * Note: sharp applies *resize before composite* within a single chain, and
 * rejects composite inputs larger than the base canvas — so each stage is
 * built as its own pipeline with matching dimensions.
 */

const W = 1600;
const H = 1200;

function wallSvg(): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <radialGradient id="g" cx="50%" cy="35%" r="80%">
        <stop offset="0%" stop-color="#f3efe8"/>
        <stop offset="100%" stop-color="#ded6c8"/>
      </radialGradient>
      <linearGradient id="fl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#b9a489"/>
        <stop offset="100%" stop-color="#8f7a60"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect y="${H - 260}" width="${W}" height="260" fill="url(#fl)"/>
    <rect y="${H - 268}" width="${W}" height="10" fill="#6f5f4c"/>
  </svg>`;
  return Buffer.from(svg);
}

/** Ensure a composite stage never places an overlay past the base edges. */
function fits(top: number, left: number, w: number, h: number, baseW: number, baseH: number): boolean {
  return top >= 0 && left >= 0 && top + h <= baseH && left + w <= baseW;
}

export async function generateMockups(
  tilePath: string,
  ext: string,
): Promise<Buffer[]> {
  const raster = ["jpg", "jpeg", "png", "webp", "avif", "tiff"];
  if (!raster.includes(ext.toLowerCase())) return [];

  try {
    const meta = await sharp(tilePath, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return [];

    const aspect = meta.width / meta.height;
    const outputs: Buffer[] = [];

    /* 1 ─ gallery frame --------------------------------------------------- */
    const frameW = 720;
    const frameH = Math.round(frameW / aspect);
    const art = await sharp(tilePath, { failOn: "none" })
      .resize(frameW, frameH, { fit: "fill" })
      .png()
      .toBuffer();
    const outerW = frameW + 64;
    const outerH = frameH + 64;
    const frame = await sharp({
      create: { width: outerW, height: outerH, channels: 3, background: "#2b2118" },
    })
      .composite([
        { input: art, top: 32, left: 32 },
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${outerW}" height="${outerH}"><rect x="26" y="26" width="${frameW + 12}" height="${frameH + 12}" fill="none" stroke="#c9a24a" stroke-width="4"/></svg>`,
          ),
          top: 0, left: 0,
        },
      ])
      .png()
      .toBuffer();

    const shadowH = outerH + 40;
    const framedComposite = await sharp({
      create: { width: outerW, height: shadowH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: frame, top: 0, left: 0 },
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${outerW}" height="40"><ellipse cx="${outerW / 2}" cy="20" rx="${outerW / 2 - 10}" ry="16" fill="rgba(0,0,0,0.28)"/></svg>`,
          ),
          top: outerH,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    const frameTop = Math.round(H * 0.18);
    const frameLeft = Math.round((W - outerW) / 2);
    if (fits(frameTop, frameLeft, outerW, shadowH, W, H)) {
      outputs.push(
        await sharp(wallSvg())
          .composite([{ input: framedComposite, top: frameTop, left: frameLeft }])
          .png()
          .toBuffer(),
      );
    }

    /* 2 ─ cushion on sofa -------------------------------------------------
       Split pipelines: sharp runs resize *before* composite in one chain,
       so a trailing resize would make the SVG overlay larger than the base. */
    const cw = 560;
    const ch = 560;
    const fabricBase = await sharp(tilePath, { failOn: "none" })
      .resize(cw, ch, { fit: "fill" })
      .png()
      .toBuffer();
    const fabricShaded = await sharp(fabricBase)
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}">
              <rect width="${cw}" height="${ch}" fill="url(#s)"/>
              <defs><radialGradient id="s" cx="50%" cy="45%" r="65%">
                <stop offset="60%" stop-color="rgba(0,0,0,0)"/>
                <stop offset="100%" stop-color="rgba(0,0,0,0.35)"/>
              </radialGradient></defs>
            </svg>`,
          ),
          top: 0, left: 0,
        },
      ])
      .png()
      .toBuffer();
    const fabric = await sharp(fabricShaded)
      .resize(480, 480, { fit: "fill" })
      .png()
      .toBuffer();

    const pillow = await sharp({
      create: { width: 560, height: 560, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: fabric, top: 40, left: 40 },
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560">
              <rect x="24" y="24" width="512" height="512" rx="48" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="6"/>
            </svg>`,
          ),
          top: 0, left: 0,
        },
      ])
      .png()
      .toBuffer();

    const stripTop = H - 560;
    const p1Top = H - 560 - 160;
    const p2Top = H - 560 - 90; // keep second pillow fully inside (was H-470 → overflowed)
    const sofaLayers: Array<{ input: Buffer; top: number; left: number }> = [];
    if (fits(stripTop, 0, W, 360, W, H)) {
      sofaLayers.push({
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="360"><rect y="60" width="${W}" height="300" rx="28" fill="#5d5348"/><rect y="60" width="${W}" height="90" rx="28" fill="#6b6055"/></svg>`),
        top: stripTop, left: 0,
      });
    }
    const p1Left = Math.round((W - 560) / 2);
    const p2Left = Math.round(W * 0.12);
    if (fits(p1Top, p1Left, 560, 560, W, H)) {
      sofaLayers.push({ input: pillow, top: p1Top, left: p1Left });
    }
    if (fits(p2Top, p2Left, 560, 560, W, H)) {
      sofaLayers.push({ input: pillow, top: p2Top, left: p2Left });
    }
    if (sofaLayers.length) {
      outputs.push(
        await sharp(wallSvg())
          .composite(sofaLayers)
          .png()
          .toBuffer(),
      );
    }

    /* 3 ─ wallpapered wall -------------------------------------------------
       Clamp the tiling loop so every tile sits fully on the wall canvas. */
    const wallH = H - 320;
    const tileW = 420;
    const tileH = Math.max(1, Math.round(420 / aspect));
    const tile = await sharp(tilePath, { failOn: "none" }).resize(tileW, tileH, { fit: "fill" }).png().toBuffer();
    const tiles: Array<{ input: Buffer; top: number; left: number }> = [];
    for (let top = 0; top + tileH <= wallH; top += tileH) {
      for (let left = 0; left + tileW <= W; left += tileW) {
        tiles.push({ input: tile, top, left });
      }
    }
    // Cover the remainder strip on the right/bottom with edge tiles.
    const lastTop = tiles.length ? tiles[tiles.length - 1]!.top + tileH : 0;
    if (lastTop < wallH && tiles.length) {
      const edgeH = wallH - lastTop;
      const edgeTop = Math.max(0, wallH - tileH);
      for (let left = 0; left + tileW <= W; left += tileW) {
        if (edgeTop + tileH <= wallH) tiles.push({ input: tile, top: edgeTop, left });
      }
      void edgeH;
    }

    const tiling = await sharp({ create: { width: W, height: wallH, channels: 3, background: "#eee" } })
      .composite(tiles)
      .png()
      .toBuffer();
    outputs.push(
      await sharp(wallSvg())
        .composite([
          { input: tiling, top: 0, left: 0 },
          {
            input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect y="${H - 330}" width="${W}" height="14" fill="#75624e"/></svg>`),
            top: 0, left: 0,
          },
        ])
        .png()
        .toBuffer(),
    );

    return outputs;
  } catch (e) {
    console.error("[mockup] generation failed:", e);
    return [];
  }
}
