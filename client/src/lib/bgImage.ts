const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.8;
/** Soft cap for stored data URL length (~2.5MB). */
export const BG_DATA_URL_MAX = 2.5 * 1024 * 1024;

export function loadStoredBgUrl(): string {
  try {
    const url = localStorage.getItem('ssh_bg_url') || '';
    if (!url) return '';
    if (url.length > BG_DATA_URL_MAX) {
      localStorage.removeItem('ssh_bg_url');
      return '';
    }
    return url;
  } catch {
    try {
      localStorage.removeItem('ssh_bg_url');
    } catch {
      /* ignore */
    }
    return '';
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

/** Resize + JPEG-compress a local image for use as app background. */
export async function compressBgImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  const raw = await readFileAsDataUrl(file);
  const img = await loadImage(raw);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法处理图片');
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  if (dataUrl.length > BG_DATA_URL_MAX) {
    throw new Error('背景图过大，请换更小的图');
  }
  return dataUrl;
}
