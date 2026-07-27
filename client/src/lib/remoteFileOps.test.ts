import { describe, expect, it } from 'vitest';
import {
  isSameOrDescendant,
  joinRemotePath,
  normalizeRemotePath,
  uniqueRemoteName,
} from './remoteFileOps';

describe('normalizeRemotePath / joinRemotePath', () => {
  it('collapses slashes and trims trailing slash', () => {
    expect(normalizeRemotePath('/home//user/')).toBe('/home/user');
    expect(normalizeRemotePath('/')).toBe('/');
    expect(joinRemotePath('/home/user', 'a.txt')).toBe('/home/user/a.txt');
    expect(joinRemotePath('/', 'etc')).toBe('/etc');
  });
});

describe('uniqueRemoteName', () => {
  it('keeps the original name when free', () => {
    expect(uniqueRemoteName('foo', false, new Set(['bar']))).toBe('foo');
  });

  it('appends 副本 and numbered copies for files with extension', () => {
    const taken = new Set(['readme.md']);
    expect(uniqueRemoteName('readme.md', false, taken)).toBe('readme 副本.md');
    taken.add('readme 副本.md');
    expect(uniqueRemoteName('readme.md', false, taken)).toBe('readme 副本 2.md');
  });

  it('appends 副本 for directories without treating dots as extensions', () => {
    const taken = new Set(['my.dir']);
    expect(uniqueRemoteName('my.dir', true, taken)).toBe('my.dir 副本');
  });
});

describe('isSameOrDescendant', () => {
  it('detects same path and nested children', () => {
    expect(isSameOrDescendant('/home/a', '/home/a')).toBe(true);
    expect(isSameOrDescendant('/home/a', '/home/a/b')).toBe(true);
    expect(isSameOrDescendant('/home/a/', '/home/a/b/c')).toBe(true);
  });

  it('does not treat sibling prefix paths as descendants', () => {
    expect(isSameOrDescendant('/home/a', '/home/ab')).toBe(false);
    expect(isSameOrDescendant('/home/a', '/home/b')).toBe(false);
    expect(isSameOrDescendant('/home/a', '/tmp/a')).toBe(false);
  });

  it('treats every absolute path as under root', () => {
    expect(isSameOrDescendant('/', '/')).toBe(true);
    expect(isSameOrDescendant('/', '/home')).toBe(true);
  });
});
