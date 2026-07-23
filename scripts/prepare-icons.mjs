/**
 * Generate Windows .ico (multi-size) from electron/icons/icon.png
 * for electron-builder installers and portable shortcuts.
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
const SIZES = [256, 128, 64, 48, 32, 16];

async function main() {
  if (!fs.existsSync(srcPng)) {
    throw new Error(`Missing brand icon: ${srcPng}`);
  }

  const pngBuffers = [];
  for (const size of SIZES) {
    pngBuffers.push(
      await sharp(srcPng)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toBuffer(),
    );
  }

  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(outIco, ico);
  console.log(`Wrote ${outIco} (${ico.length} bytes, sizes ${SIZES.join('/')})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
