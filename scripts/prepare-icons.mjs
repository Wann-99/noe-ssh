/**
 * Clean brand icon (knock out white plate, rounder alpha mask),
 * then generate Windows .ico and Linux hicolor PNG sizes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'electron', 'icons');
const srcPng = path.join(iconsDir, 'icon.png');
const outIco = path.join(iconsDir, 'icon.ico');
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
/** Corner radius as fraction of width — slightly rounder for dock/menu. */
const CORNER_RATIO = 0.26;

function isPaperWhite(r, g, b, a) {
  if (a < 8) return true;
  return r >= 245 && g >= 245 && b >= 245;
}

/** Flood-fill near-white edge pixels to transparent so docks don't show a white plate. */
function knockOutWhitePlate(data, width, height) {
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i]) return;
    const o = i * 4;
    if (!isPaperWhite(data[o], data[o + 1], data[o + 2], data[o + 3])) return;
    seen[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length) {
    const i = stack.pop();
    const o = i * 4;
    data[o] = 0;
    data[o + 1] = 0;
    data[o + 2] = 0;
    data[o + 3] = 0;
    const x = i % width;
    const y = (i / width) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

function roundedRectMask(width, height, radius) {
  // SVG mask → sharp; keep opaque inside round-rect
  const r = Math.max(1, Math.round(radius));
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/>
    </svg>`,
  );
}

async function cleanMasterIcon(inputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (channels !== 4) throw new Error(`Expected RGBA, got ${channels} channels`);

  knockOutWhitePlate(data, width, height);

  const cleared = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  const radius = width * CORNER_RATIO;
  const masked = await sharp(cleared)
    .composite([{
      input: roundedRectMask(width, height, radius),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();

  return masked;
}

async function main() {
  if (!fs.existsSync(srcPng)) {
    throw new Error(`Missing brand icon: ${srcPng}`);
  }

  const cleaned = await cleanMasterIcon(srcPng);
  fs.writeFileSync(srcPng, cleaned);
  console.log(`Cleaned master icon (transparent plate + ${Math.round(CORNER_RATIO * 100)}% round corners)`);

  // Keep web / PWA icons in sync
  for (const rel of ['client/public/logo.png', 'client/public/favicon.png', 'client/public/apple-touch-icon.png']) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(srcPng, dest);
    console.log(`Synced ${rel}`);
  }

  const icoBuffers = [];
  for (const size of ICO_SIZES) {
    icoBuffers.push(
      await sharp(cleaned).resize(size, size, { fit: 'cover' }).png().toBuffer(),
    );
  }
  const ico = await pngToIco(icoBuffers);
  fs.writeFileSync(outIco, ico);
  console.log(`Wrote ${outIco} (${ico.length} bytes)`);

  const linuxDir = path.join(iconsDir, 'linux');
  fs.mkdirSync(linuxDir, { recursive: true });
  for (const size of [...LINUX_SIZES, 1024]) {
    const name = `${size}x${size}.png`;
    const buf = await sharp(cleaned).resize(size, size, { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(path.join(iconsDir, name), buf);
    fs.writeFileSync(path.join(linuxDir, name), buf);
    console.log(`Wrote ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
