export type QuickTarget = { host: string; username?: string; port?: number };

/** Parse quick-connect input: [ssh] [user@]host[:port] */
export function parseQuickTarget(raw: string): QuickTarget | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^ssh\s+/i, '');
  let username: string | undefined;
  let port: number | undefined;
  const at = s.lastIndexOf('@');
  if (at >= 0) {
    username = s.slice(0, at).trim() || undefined;
    s = s.slice(at + 1);
  }
  const colon = s.lastIndexOf(':');
  if (colon > 0 && s.indexOf(':') === colon) {
    const p = Number(s.slice(colon + 1));
    if (Number.isFinite(p) && p > 0 && p < 65536) {
      port = p;
      s = s.slice(0, colon);
    }
  }
  const host = s.trim();
  if (!host) return null;
  return { host, username, port };
}

/** Find a saved connection matching host+port (+username when the target specifies one). */
export function matchSavedConnection(
  saved: Array<Record<string, unknown>>,
  target: QuickTarget,
): Record<string, unknown> | undefined {
  const port = target.port || 22;
  return saved.find((c) => (
    String(c.host) === target.host
    && Number(c.port || 22) === port
    && (!target.username || String(c.username) === target.username)
  ));
}
