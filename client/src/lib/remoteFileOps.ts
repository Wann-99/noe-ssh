/** Join remote path segments and collapse duplicate slashes. */
export function joinRemotePath(...parts: string[]): string {
  const joined = parts
    .filter((part) => part != null && part !== '')
    .join('/')
    .replace(/\/+/g, '/');
  if (joined.length > 1 && joined.endsWith('/')) return joined.slice(0, -1);
  return joined || '/';
}

/** Normalize for comparison: collapse slashes, drop trailing slash (except root). */
export function normalizeRemotePath(path: string): string {
  if (!path || path === '.') return '/';
  const normalized = path.replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized || '/';
}

/**
 * True when `candidate` is the same as `ancestor`, or a path under it.
 * Used to block copying a directory into itself / a child.
 */
export function isSameOrDescendant(ancestor: string, candidate: string): boolean {
  const parent = normalizeRemotePath(ancestor);
  const child = normalizeRemotePath(candidate);
  if (child === parent) return true;
  if (parent === '/') return child.startsWith('/');
  return child.startsWith(`${parent}/`);
}

/**
 * Pick a free name in the destination directory.
 * `foo` → `foo 副本` → `foo 副本 2` (extensions preserved for files).
 */
export function uniqueRemoteName(name: string, isDir: boolean, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let stem = name;
  let ext = '';
  if (!isDir) {
    const dot = name.lastIndexOf('.');
    if (dot > 0) {
      stem = name.slice(0, dot);
      ext = name.slice(dot);
    }
  }
  let candidate = `${stem} 副本${ext}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${stem} 副本 ${n}${ext}`;
    n += 1;
  }
  return candidate;
}
