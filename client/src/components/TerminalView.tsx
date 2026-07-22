import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { ChevronDown, ChevronUp, Files, Search, Trash2, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { INACTIVE_PENDING_MAX } from '@shared/wsBinary';
import { useAppStore } from '../store/appStore';

/** Fixed fresh theme — translucent-friendly dark + teal accent */
const FRESH_THEME = {
  background: 'rgba(8, 14, 20, 0.35)',
  foreground: '#d4dde6',
  cursor: '#3ecfbf',
  cursorAccent: '#0a1014',
  selectionBackground: 'rgba(62,207,191,0.28)',
  black: '#0c1014',
  red: '#f07178',
  green: '#7fd99a',
  yellow: '#e6c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#3ecfbf',
  white: '#d4dde6',
  brightBlack: '#5c6773',
  brightRed: '#f07178',
  brightGreen: '#7fd99a',
  brightYellow: '#e6c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56d4c4',
  brightWhite: '#e7eef5',
};

type WriteChunk = string | Uint8Array;

type TerminalEntry = {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  disposables: Array<{ dispose: () => void }>;
};

function chunkByteLength(chunk: WriteChunk) {
  return typeof chunk === 'string' ? chunk.length : chunk.byteLength;
}

export function TerminalView({ visible }: { visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionHostsRef = useRef(new Map<string, HTMLDivElement>());
  const entriesRef = useRef(new Map<string, TerminalEntry>());
  /** Pending writes when terminal not yet created. */
  const pendingCreatesRef = useRef(new Map<string, WriteChunk[]>());
  /** Inactive-session ring buffer (approx last 64KB). */
  const inactivePendingRef = useRef(new Map<string, { chunks: WriteChunk[]; bytes: number }>());
  /** Active-session rAF write batch. */
  const writeBatchRef = useRef(new Map<string, WriteChunk[]>());
  const rafRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const termFontSize = useAppStore((s) => s.termFontSize);
  const setFontSize = useAppStore((s) => s.setFontSize);
  const toggleFilePanel = useAppStore((s) => s.toggleFilePanel);
  activeSessionIdRef.current = activeSessionId;

  const flushBatch = useCallback(() => {
    rafRef.current = null;
    for (const [sessionId, chunks] of writeBatchRef.current) {
      if (!chunks.length) continue;
      const entry = entriesRef.current.get(sessionId);
      if (!entry) continue;
      if (chunks.length === 1) {
        entry.term.write(chunks[0]);
      } else {
        // Prefer a single string write when all chunks are strings.
        let allString = true;
        for (const c of chunks) {
          if (typeof c !== 'string') {
            allString = false;
            break;
          }
        }
        if (allString) {
          entry.term.write((chunks as string[]).join(''));
        } else {
          for (const c of chunks) entry.term.write(c);
        }
      }
    }
    writeBatchRef.current.clear();
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flushBatch);
  }, [flushBatch]);

  const pushInactive = useCallback((sessionId: string, data: WriteChunk) => {
    let buf = inactivePendingRef.current.get(sessionId);
    if (!buf) {
      buf = { chunks: [], bytes: 0 };
      inactivePendingRef.current.set(sessionId, buf);
    }
    buf.chunks.push(data);
    buf.bytes += chunkByteLength(data);
    while (buf.bytes > INACTIVE_PENDING_MAX && buf.chunks.length > 1) {
      const dropped = buf.chunks.shift();
      if (dropped) buf.bytes -= chunkByteLength(dropped);
    }
  }, []);

  const enqueueWrite = useCallback((sessionId: string, data: WriteChunk) => {
    const entry = entriesRef.current.get(sessionId);
    if (!entry) {
      const pending = pendingCreatesRef.current.get(sessionId) || [];
      pending.push(data);
      // Cap create-pending similarly
      let bytes = pending.reduce((n, c) => n + chunkByteLength(c), 0);
      while (bytes > INACTIVE_PENDING_MAX && pending.length > 1) {
        const dropped = pending.shift();
        if (dropped) bytes -= chunkByteLength(dropped);
      }
      pendingCreatesRef.current.set(sessionId, pending);
      return;
    }

    if (sessionId !== activeSessionIdRef.current) {
      pushInactive(sessionId, data);
      return;
    }

    const batch = writeBatchRef.current.get(sessionId) || [];
    batch.push(data);
    writeBatchRef.current.set(sessionId, batch);
    scheduleFlush();
  }, [pushInactive, scheduleFlush]);

  const fitSession = useCallback((sessionId: string) => {
    const entry = entriesRef.current.get(sessionId);
    const host = sessionHostsRef.current.get(sessionId);
    if (!entry || !host || !visible || host.clientWidth < 10 || host.clientHeight < 10) return;
    try {
      entry.fit.fit();
      const dims = entry.fit.proposeDimensions();
      if (dims) useAppStore.getState().sendResize(dims.cols, dims.rows, sessionId);
    } catch {
      // The host can be between layout states during a splitter drag.
    }
  }, [visible]);

  const createTerminal = useCallback((sessionId: string, host: HTMLDivElement) => {
    if (entriesRef.current.has(sessionId)) return;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: useAppStore.getState().termFontSize,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono')
        || '"Cascadia Code", Consolas, monospace',
      theme: FRESH_THEME,
      allowProposedApi: true,
      scrollback: 5_000,
      smoothScrollDuration: 0,
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try { webgl.dispose(); } catch { /* ignore */ }
      });
      term.loadAddon(webgl);
    } catch {
      // DOM renderer fallback
    }
    const disposables = [
      term.onData((data) => useAppStore.getState().sendInput(data, sessionId)),
    ];
    entriesRef.current.set(sessionId, { term, fit, search, disposables });
    term.writeln(`\x1b[90mNoe-SSH · 会话已就绪\x1b[0m`);
    const pending = pendingCreatesRef.current.get(sessionId);
    if (pending?.length) {
      pending.forEach((data) => term.write(data));
      pendingCreatesRef.current.delete(sessionId);
    }
  }, []);

  useEffect(() => {
    const liveIds = new Set(sessions.map((session) => session.id));
    sessions.forEach((session) => {
      const host = sessionHostsRef.current.get(session.id);
      if (host) createTerminal(session.id, host);
    });
    for (const [id, entry] of entriesRef.current) {
      if (liveIds.has(id)) continue;
      entry.disposables.forEach((disposable) => disposable.dispose());
      entry.term.dispose();
      entriesRef.current.delete(id);
      pendingCreatesRef.current.delete(id);
      inactivePendingRef.current.delete(id);
      writeBatchRef.current.delete(id);
    }
  }, [sessions, createTerminal]);

  useEffect(() => {
    const onWrite = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { sessionId: string; data: WriteChunk };
      enqueueWrite(detail.sessionId, detail.data);
    };
    window.addEventListener('ssh-term-write', onWrite);
    return () => window.removeEventListener('ssh-term-write', onWrite);
  }, [enqueueWrite]);

  // Flush inactive buffer when a session becomes active.
  useEffect(() => {
    if (!activeSessionId) return;
    const buf = inactivePendingRef.current.get(activeSessionId);
    if (buf?.chunks.length) {
      const entry = entriesRef.current.get(activeSessionId);
      if (entry) {
        for (const chunk of buf.chunks) entry.term.write(chunk);
      }
      inactivePendingRef.current.delete(activeSessionId);
    }
    // Also flush any pending rAF batch immediately for responsiveness.
    flushBatch();
  }, [activeSessionId, flushBatch]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        setFontSize(Math.min(24, useAppStore.getState().termFontSize + 1));
      }
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        setFontSize(Math.max(10, useAppStore.getState().termFontSize - 1));
      }
      if (e.key === 'F11') {
        e.preventDefault();
        document.querySelector('.main-stage')?.classList.toggle('fullscreen');
        setTimeout(() => {
          const id = useAppStore.getState().activeSessionId;
          if (id) fitSession(id);
        }, 100);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, fitSession, setFontSize]);

  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;
    const fitActive = () => {
      const id = useAppStore.getState().activeSessionId;
      if (id) fitSession(id);
    };
    const observer = new ResizeObserver(fitActive);
    observer.observe(root);
    window.addEventListener('resize', fitActive);
    window.addEventListener('ssh-layout-resize', fitActive);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fitActive);
      window.removeEventListener('ssh-layout-resize', fitActive);
    };
  }, [fitSession]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    for (const entry of entriesRef.current.values()) {
      entry.disposables.forEach((disposable) => disposable.dispose());
      entry.term.dispose();
    }
    entriesRef.current.clear();
  }, []);

  useEffect(() => {
    for (const entry of entriesRef.current.values()) {
      entry.term.options.fontSize = termFontSize;
    }
    if (activeSessionId) fitSession(activeSessionId);
  }, [termFontSize, activeSessionId, fitSession]);

  useEffect(() => {
    if (activeSessionId && visible) {
      requestAnimationFrame(() => {
        fitSession(activeSessionId);
        entriesRef.current.get(activeSessionId)?.term.focus();
      });
    }
  }, [activeSessionId, visible, fitSession]);

  const getActiveEntry = () => {
    const id = useAppStore.getState().activeSessionId;
    return id ? entriesRef.current.get(id) : null;
  };
  const runSearch = (direction: 'next' | 'previous') => {
    const activeEntry = getActiveEntry();
    if (!activeEntry || !searchQuery) return;
    if (direction === 'next') activeEntry.search.findNext(searchQuery);
    else activeEntry.search.findPrevious(searchQuery);
  };

  return (
    <div className="terminal-wrap">
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-label">SSH Terminal</div>
        <div className="terminal-toolbar-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => setSearchOpen((open) => !open)}
            title="搜索终端 (Ctrl+F)"
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => getActiveEntry()?.term.clear()}
            title="清屏"
          >
            <Trash2 size={15} />
          </button>
          <button type="button" className="icon-button" onClick={toggleFilePanel} title="切换文件面板">
            <Files size={15} />
          </button>
        </div>
      </div>
      {searchOpen && (
        <div className="terminal-search">
          <Search size={14} />
          <input
            autoFocus
            value={searchQuery}
            placeholder="在终端中搜索"
            onChange={(event) => {
              setSearchQuery(event.target.value);
              getActiveEntry()?.search.findNext(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch(event.shiftKey ? 'previous' : 'next');
              if (event.key === 'Escape') setSearchOpen(false);
            }}
          />
          <button type="button" className="icon-button" onClick={() => runSearch('previous')} aria-label="上一个">
            <ChevronUp size={14} />
          </button>
          <button type="button" className="icon-button" onClick={() => runSearch('next')} aria-label="下一个">
            <ChevronDown size={14} />
          </button>
          <button type="button" className="icon-button" onClick={() => setSearchOpen(false)} aria-label="关闭搜索">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="terminal-host" ref={hostRef}>
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`terminal-session ${session.id === activeSessionId ? 'active' : ''}`}
            ref={(node) => {
              if (node) {
                sessionHostsRef.current.set(session.id, node);
                createTerminal(session.id, node);
              } else {
                sessionHostsRef.current.delete(session.id);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
