/**
 * Generate Windows .ico and Linux hicolor PNG sizes from electron/icons/icon.png.
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
/** Sizes electron-builder / desktop environments expect for Linux. */
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [256, 128, 64, 48, 32, 16];

async function main() {
  if (!fs.existsSync(srcPng)) {
    throw new Error(`Missing brand icon: ${srcPng}`);
  }

  const icoBuffers = [];
  for (const size of ICO_SIZES) {
    icoBuffers.push(
      await sharp(srcPng).resize(size, size, { fit: 'cover' }).png().toBuffer(),
    );
  }
  const ico = await pngToIco(icoBuffers);
  fs.writeFileSync(outIco, ico);
  console.log(`Wrote ${outIco} (${ico.length} bytes)`);

  const linuxDir = path.join(iconsDir, 'linux');
  fs.mkdirSync(linuxDir, { recursive: true });
  for (const size of [...LINUX_SIZES, 1024]) {
    const name = `${size}x${size}.png`;
    const buf = await sharp(srcPng).resize(size, size, { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(path.join(iconsDir, name), buf);
    fs.writeFileSync(path.join(linuxDir, name), buf);
    console.log(`Wrote ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
