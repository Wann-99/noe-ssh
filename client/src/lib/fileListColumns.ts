export type PreferredCols = { name: number; size: number; time: number };
export type AllocatedCols = PreferredCols;

export const FP_COLS_KEY = 'ssh_fp_cols_v2';
export const COL_MENU = 28;
export const COL_GAP = 6;
export const NAME_ICON_SPACE = 23; // 16px icon + 7px margin

export const COL_MIN: PreferredCols = { name: 96, size: 48, time: 64 };
export const COL_MAX: PreferredCols = { name: 900, size: 200, time: 240 };
export const DEFAULT_COLS: PreferredCols = { name: 200, size: 68, time: 88 };

export function clampRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function viewStorageKey(host: string | undefined, remotePath: string) {
  return `${host || '_'}::${remotePath || '/'}`;
}

function sanitizeCols(raw: unknown): PreferredCols | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    name: clampRange(Number(o.name) || DEFAULT_COLS.name, COL_MIN.name, COL_MAX.name),
    size: clampRange(Number(o.size) || DEFAULT_COLS.size, COL_MIN.size, COL_MAX.size),
    time: clampRange(Number(o.time) || DEFAULT_COLS.time, COL_MIN.time, COL_MAX.time),
  };
}

export function loadAllColumnViews(): Record<string, PreferredCols> {
  try {
    const raw = JSON.parse(localStorage.getItem(FP_COLS_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, PreferredCols> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const cols = sanitizeCols(value);
      if (cols) out[key] = cols;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadColumnView(key: string): PreferredCols {
  return loadAllColumnViews()[key] || { ...DEFAULT_COLS };
}

export function saveColumnView(key: string, cols: PreferredCols) {
  try {
    const all = loadAllColumnViews();
    all[key] = {
      name: clampRange(cols.name, COL_MIN.name, COL_MAX.name),
      size: clampRange(cols.size, COL_MIN.size, COL_MAX.size),
      time: clampRange(cols.time, COL_MIN.time, COL_MAX.time),
    };
    localStorage.setItem(FP_COLS_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
}

export function contentBudget(panelW: number) {
  // 菜单绝对定位在右侧，不进 flex；预留菜单宽 + name|size|time 之间 2 个 gap
  // （spacer 可缩到 0，其两侧 gap 在极窄时仍计 1 个缓冲）
  return Math.max(
    COL_MIN.name + COL_MIN.size + COL_MIN.time,
    panelW - COL_MENU - COL_GAP * 3,
  );
}

/**
 * Allocate column widths. Each preferred width is independent.
 * Leftover space is NOT absorbed by name (stays as trailing empty area),
 * so adjusting one column does not move the others' boundaries.
 * Only when the panel is too narrow do we squeeze time → size → name.
 */
export function allocateColumns(panelW: number, preferred: PreferredCols): AllocatedCols {
  const avail = contentBudget(panelW);

  let name = clampRange(preferred.name, COL_MIN.name, COL_MAX.name);
  let size = clampRange(preferred.size, COL_MIN.size, COL_MAX.size);
  let time = clampRange(preferred.time, COL_MIN.time, COL_MAX.time);

  const total = name + size + time;
  if (total > avail) {
    let overflow = total - avail;
    const timeCut = Math.min(overflow, time - COL_MIN.time);
    time -= timeCut;
    overflow -= timeCut;
    const sizeCut = Math.min(overflow, size - COL_MIN.size);
    size -= sizeCut;
    overflow -= sizeCut;
    if (overflow > 0) {
      name = Math.max(COL_MIN.name, name - overflow);
    }
  }

  return { name, size, time };
}

/** Max width for one column without shrinking the other two below their mins. */
export function maxExclusiveWidth(
  panelW: number,
  key: keyof PreferredCols,
  others: PreferredCols,
): number {
  const avail = contentBudget(panelW);
  if (key === 'name') return Math.min(COL_MAX.name, avail - others.size - others.time);
  if (key === 'size') return Math.min(COL_MAX.size, avail - others.name - others.time);
  return Math.min(COL_MAX.time, avail - others.name - others.size);
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function measureTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') return text.length * 8;
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** End ellipsis: truncate from the tail (filename…). */
export function fitEndEllipsis(
  text: string,
  maxPx: number,
  font: string,
): { text: string; truncated: boolean } {
  if (maxPx <= 0) return { text: '', truncated: true };
  if (measureTextWidth(text, font) <= maxPx) return { text, truncated: false };

  const ell = '…';
  const ellW = measureTextWidth(ell, font);
  if (ellW >= maxPx) return { text: ell, truncated: true };

  let best = ell;
  let lo = 0;
  let hi = text.length;
  while (lo <= hi) {
    const n = Math.floor((lo + hi) / 2);
    const candidate = `${text.slice(0, Math.max(0, n))}${ell}`;
    if (measureTextWidth(candidate, font) <= maxPx) {
      best = candidate;
      lo = n + 1;
    } else {
      hi = n - 1;
    }
  }
  return { text: best, truncated: true };
}

/** @deprecated use fitEndEllipsis */
export const fitMiddleEllipsis = fitEndEllipsis;

export function measureLongestNameWidth(names: string[], font: string): number {
  let max = COL_MIN.name;
  for (const name of names) {
    max = Math.max(max, Math.ceil(measureTextWidth(name, font) + NAME_ICON_SPACE));
  }
  return max;
}
