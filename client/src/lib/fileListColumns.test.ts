import { describe, expect, it } from 'vitest';
import {
  COL_MIN,
  allocateColumns,
  fitEndEllipsis,
  maxExclusiveWidth,
  measureTextWidth,
  viewStorageKey,
} from './fileListColumns';

describe('allocateColumns', () => {
  it('keeps preferred widths when there is leftover space', () => {
    const out = allocateColumns(500, { name: 120, size: 68, time: 88 });
    expect(out).toEqual({ name: 120, size: 68, time: 88 });
  });

  it('squeezes time then size when the panel is tight', () => {
    const out = allocateColumns(220, { name: 200, size: 100, time: 100 });
    expect(out.time).toBe(COL_MIN.time);
    expect(out.size).toBeLessThanOrEqual(100);
    expect(out.name).toBeGreaterThanOrEqual(COL_MIN.name);
  });
});

describe('maxExclusiveWidth', () => {
  it('does not force other columns below their minimums', () => {
    const others = { name: 200, size: 68, time: 88 };
    const maxName = maxExclusiveWidth(400, 'name', others);
    expect(maxName).toBe(400 - 28 - 18 - 68 - 88);
    expect(maxExclusiveWidth(400, 'size', others)).toBe(400 - 28 - 18 - 200 - 88);
  });
});

describe('viewStorageKey', () => {
  it('joins host and path', () => {
    expect(viewStorageKey('h', '/a/b')).toBe('h::/a/b');
    expect(viewStorageKey(undefined, '/')).toBe('_::/');
  });
});

describe('fitEndEllipsis', () => {
  it('returns original text when it fits', () => {
    const font = '14px monospace';
    const out = fitEndEllipsis('short.txt', 500, font);
    expect(out.truncated).toBe(false);
    expect(out.text).toBe('short.txt');
  });

  it('truncates from the end with an ellipsis', () => {
    const font = '14px monospace';
    const long = 'very_long_filename_for_end_ellipsis_test.pdf';
    const fullW = measureTextWidth(long, font);
    const out = fitEndEllipsis(long, Math.max(40, fullW * 0.45), font);
    expect(out.truncated).toBe(true);
    expect(out.text.endsWith('…')).toBe(true);
    expect(out.text.startsWith('very_')).toBe(true);
    expect(out.text.includes('…pdf')).toBe(false);
  });
});
