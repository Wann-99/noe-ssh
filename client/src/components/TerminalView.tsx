import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
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

export function TerminalView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const termFontSize = useAppStore((s) => s.termFontSize);
  const sendInput = useAppStore((s) => s.sendInput);
  const sendResize = useAppStore((s) => s.sendResize);
  const setFontSize = useAppStore((s) => s.setFontSize);
  const toggleFilePanel = useAppStore((s) => s.toggleFilePanel);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: termFontSize,
      fontFamily: "'IBM Plex Mono', Menlo, monospace",
      theme: FRESH_THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((d) => sendInput(d));

    const onResize = () => {
      fit.fit();
      const d = fit.proposeDimensions();
      if (d) sendResize(d.cols, d.rows);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('ssh-layout-resize', onResize);

    const onWrite = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { sessionId: string; data: string };
      if (detail.sessionId === useAppStore.getState().activeSessionId) {
        term.write(detail.data);
      }
    };
    window.addEventListener('ssh-term-write', onWrite);

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        term.clear();
      }
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        const q = prompt('搜索');
        if (q) search.findNext(q);
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
        setTimeout(onResize, 100);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('ssh-layout-resize', onResize);
      window.removeEventListener('ssh-term-write', onWrite);
      window.removeEventListener('keydown', onKey);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current && fitRef.current) {
      termRef.current.options.fontSize = termFontSize;
      fitRef.current.fit();
    }
  }, [termFontSize]);

  useEffect(() => {
    termRef.current?.clear();
    termRef.current?.writeln(`\x1b[90m— 会话 ${activeSessionId || ''} —\x1b[0m`);
  }, [activeSessionId]);

  return (
    <div className="terminal-wrap">
      <div className="terminal-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => termRef.current?.clear()}>清屏</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleFilePanel}>文件面板</button>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  );
}
