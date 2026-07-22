import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import {
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { DEFAULT_TERMINAL_ID } from '@shared/protocol';
import { INACTIVE_PENDING_MAX } from '@shared/wsBinary';
import { useAppStore } from '../store/appStore';

/** Glass workbench terminal theme — electric blue accent */
const FRESH_THEME = {
  background: 'rgba(12, 16, 24, 0.2)',
  foreground: '#e8eef7',
  cursor: '#60a5fa',
  cursorAccent: '#0c1018',
  selectionBackground: 'rgba(59,130,246,0.32)',
  black: '#0c1014',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#67e8f9',
  white: '#e8eef7',
  brightBlack: '#6b778a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#a5f3fc',
  brightWhite: '#f8fafc',
};

type WriteChunk = string | Uint8Array;

type TerminalEntry = {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  disposables: Array<{ dispose: () => void }>;
};

function termKey(sessionId: string, terminalId: string) {
  return `${sessionId}::${terminalId}`;
}

function chunkByteLength(chunk: WriteChunk) {
  return typeof chunk === 'string' ? chunk.length : chunk.byteLength;
}

export function TerminalView({ visible }: { visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termHostsRef = useRef(new Map<string, HTMLDivElement>());
  const entriesRef = useRef(new Map<string, TerminalEntry>());
  /** Pending writes when terminal not yet created. */
  const pendingCreatesRef = useRef(new Map<string, WriteChunk[]>());
  /** Inactive-pane ring buffer (approx last 64KB). */
  const inactivePendingRef = useRef(new Map<string, { chunks: WriteChunk[]; bytes: number }>());
  /** Active-pane rAF write batch. */
  const writeBatchRef = useRef(new Map<string, WriteChunk[]>());
  const rafRef = useRef<number | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const termFontSize = useAppStore((s) => s.termFontSize);
  const setFontSize = useAppStore((s) => s.setFontSize);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeTerminalId = activeSession?.activeTerminalId || DEFAULT_TERMINAL_ID;
  activeKeyRef.current = activeSessionId
    ? termKey(activeSessionId, activeTerminalId)
    : null;

  const flushBatch = useCallback(() => {
    rafRef.current = null;
    for (const [key, chunks] of writeBatchRef.current) {
      if (!chunks.length) continue;
      const entry = entriesRef.current.get(key);
      if (!entry) continue;
      if (chunks.length === 1) {
        entry.term.write(chunks[0]);
      } else {
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

  const pushInactive = useCallback((key: string, data: WriteChunk) => {
    let buf = inactivePendingRef.current.get(key);
    if (!buf) {
      buf = { chunks: [], bytes: 0 };
      inactivePendingRef.current.set(key, buf);
    }
    buf.chunks.push(data);
    buf.bytes += chunkByteLength(data);
    while (buf.bytes > INACTIVE_PENDING_MAX && buf.chunks.length > 1) {
      const dropped = buf.chunks.shift();
      if (dropped) buf.bytes -= chunkByteLength(dropped);
    }
  }, []);

  const enqueueWrite = useCallback((sessionId: string, terminalId: string, data: WriteChunk) => {
    const key = termKey(sessionId, terminalId || DEFAULT_TERMINAL_ID);
    const entry = entriesRef.current.get(key);
    if (!entry) {
      const pending = pendingCreatesRef.current.get(key) || [];
      pending.push(data);
      let bytes = pending.reduce((n, c) => n + chunkByteLength(c), 0);
      while (bytes > INACTIVE_PENDING_MAX && pending.length > 1) {
        const dropped = pending.shift();
        if (dropped) bytes -= chunkByteLength(dropped);
      }
      pendingCreatesRef.current.set(key, pending);
      return;
    }

    if (key !== activeKeyRef.current) {
      pushInactive(key, data);
      return;
    }

    const batch = writeBatchRef.current.get(key) || [];
    batch.push(data);
    writeBatchRef.current.set(key, batch);
    scheduleFlush();
  }, [pushInactive, scheduleFlush]);

  const fitPane = useCallback((sessionId: string, terminalId: string) => {
    const key = termKey(sessionId, terminalId);
    const entry = entriesRef.current.get(key);
    const host = termHostsRef.current.get(key);
    if (!entry || !host || !visible || host.clientWidth < 10 || host.clientHeight < 10) return;
    try {
      entry.fit.fit();
      const dims = entry.fit.proposeDimensions();
      if (dims) useAppStore.getState().sendResize(dims.cols, dims.rows, sessionId, terminalId);
    } catch {
      // The host can be between layout states during a splitter drag.
    }
  }, [visible]);

  const createTerminal = useCallback((sessionId: string, terminalId: string, host: HTMLDivElement) => {
    const key = termKey(sessionId, terminalId);
    if (entriesRef.current.has(key)) return;
    const termFont = [
      '"Cascadia Code"',
      'Consolas',
      '"Sarasa Mono SC"',
      '"Noto Sans Mono CJK SC"',
      '"Microsoft YaHei"',
      '"PingFang SC"',
      'monospace',
    ].join(', ');
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: useAppStore.getState().termFontSize,
      fontFamily: termFont,
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
    const disposables = [
      term.onData((data) => useAppStore.getState().sendInput(data, sessionId, terminalId)),
    ];
    entriesRef.current.set(key, { term, fit, search, disposables });
    term.writeln('\x1b[90m会话已就绪\x1b[0m');
    const pending = pendingCreatesRef.current.get(key);
    if (pending?.length) {
      pending.forEach((data) => term.write(data));
      pendingCreatesRef.current.delete(key);
    }
  }, []);

  const disposeEntry = useCallback((key: string) => {
    const entry = entriesRef.current.get(key);
    if (!entry) return;
    entry.disposables.forEach((disposable) => disposable.dispose());
    entry.term.dispose();
    entriesRef.current.delete(key);
    pendingCreatesRef.current.delete(key);
    inactivePendingRef.current.delete(key);
    writeBatchRef.current.delete(key);
  }, []);

  useEffect(() => {
    const liveKeys = new Set<string>();
    for (const session of sessions) {
      for (const pane of session.terminals) {
        const key = termKey(session.id, pane.id);
        liveKeys.add(key);
        const host = termHostsRef.current.get(key);
        if (host) createTerminal(session.id, pane.id, host);
      }
    }
    for (const key of [...entriesRef.current.keys()]) {
      if (!liveKeys.has(key)) disposeEntry(key);
    }
  }, [sessions, createTerminal, disposeEntry]);

  useEffect(() => {
    const onWrite = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        sessionId: string;
        terminalId?: string;
        data: WriteChunk;
      };
      enqueueWrite(detail.sessionId, detail.terminalId || DEFAULT_TERMINAL_ID, detail.data);
    };
    window.addEventListener('ssh-term-write', onWrite);
    return () => window.removeEventListener('ssh-term-write', onWrite);
  }, [enqueueWrite]);

  useEffect(() => {
    const key = activeKeyRef.current;
    if (!key) return;
    const buf = inactivePendingRef.current.get(key);
    if (buf?.chunks.length) {
      const entry = entriesRef.current.get(key);
      if (entry) {
        for (const chunk of buf.chunks) entry.term.write(chunk);
      }
      inactivePendingRef.current.delete(key);
    }
    flushBatch();
  }, [activeSessionId, activeTerminalId, flushBatch]);

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
          const state = useAppStore.getState();
          const sid = state.activeSessionId;
          const sess = state.sessions.find((item) => item.id === sid);
          if (sid && sess?.activeTerminalId) fitPane(sid, sess.activeTerminalId);
        }, 100);
      }
    };
    const onToggleSearch = () => setSearchOpen((open) => !open);
    const onClear = () => {
      const key = activeKeyRef.current;
      if (key) entriesRef.current.get(key)?.term.clear();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('ssh-term-toggle-search', onToggleSearch);
    window.addEventListener('ssh-term-clear', onClear);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ssh-term-toggle-search', onToggleSearch);
      window.removeEventListener('ssh-term-clear', onClear);
    };
  }, [visible, fitPane, setFontSize]);

  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;
    const fitActive = () => {
      const state = useAppStore.getState();
      const sid = state.activeSessionId;
      const sess = state.sessions.find((item) => item.id === sid);
      if (sid && sess?.activeTerminalId) fitPane(sid, sess.activeTerminalId);
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
  }, [fitPane]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    for (const key of [...entriesRef.current.keys()]) disposeEntry(key);
  }, [disposeEntry]);

  useEffect(() => {
    for (const entry of entriesRef.current.values()) {
      entry.term.options.fontSize = termFontSize;
    }
    if (activeSessionId && activeTerminalId) fitPane(activeSessionId, activeTerminalId);
  }, [termFontSize, activeSessionId, activeTerminalId, fitPane]);

  useEffect(() => {
    if (!activeSessionId || !activeTerminalId || !visible) return;
    const key = termKey(activeSessionId, activeTerminalId);
    const activate = () => {
      for (const [entryKey, entry] of entriesRef.current) {
        if (entryKey !== key) {
          try {
            entry.term.blur();
          } catch {
            /* ignore */
          }
        }
      }
      fitPane(activeSessionId, activeTerminalId);
      entriesRef.current.get(key)?.term.focus();
    };
    // Wait for layout: newly added panes may still be settling after tab switch.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(activate);
    });
    const timer = window.setTimeout(activate, 40);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [activeSessionId, activeTerminalId, visible, fitPane]);

  const getActiveEntry = () => {
    const key = activeKeyRef.current;
    return key ? entriesRef.current.get(key) : null;
  };
  const runSearch = (direction: 'next' | 'previous') => {
    const activeEntry = getActiveEntry();
    if (!activeEntry || !searchQuery) return;
    if (direction === 'next') activeEntry.search.findNext(searchQuery);
    else activeEntry.search.findPrevious(searchQuery);
  };

  return (
    <div className="terminal-wrap">
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
        {sessions.flatMap((session) =>
          session.terminals.map((pane) => {
            const key = termKey(session.id, pane.id);
            const active = session.id === activeSessionId && pane.id === (session.activeTerminalId || DEFAULT_TERMINAL_ID);
            return (
              <div
                key={key}
                className={`terminal-session ${active ? 'active' : ''}`}
                aria-hidden={!active}
                onMouseDown={() => {
                  if (active) entriesRef.current.get(key)?.term.focus();
                }}
                ref={(node) => {
                  if (node) {
                    termHostsRef.current.set(key, node);
                    createTerminal(session.id, pane.id, node);
                  } else {
                    termHostsRef.current.delete(key);
                  }
                }}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
