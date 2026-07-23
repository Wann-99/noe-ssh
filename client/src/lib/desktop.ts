export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version?: string; detail?: string }
  | { type: 'not-available'; version?: string; manual?: boolean }
  | { type: 'downloading' }
  | { type: 'progress'; percent: number; transferred?: number; total?: number; bytesPerSecond?: number }
  | { type: 'downloaded'; version?: string }
  | { type: 'error'; message: string; code?: string };

export type DesktopEditorState = {
  id: string;
  sessionId: string;
  path: string;
  content: string;
  original: string;
  size: number;
  mtime: number | null;
  saving: boolean;
  dirty: boolean;
  zIndex: number;
};

export type DesktopEditorChildMessage =
  | { type: 'ready'; id: string }
  | { type: 'change'; id: string; content: string }
  | { type: 'save'; id: string; content?: string }
  | { type: 'close'; id: string; force?: boolean }
  | { type: 'minimize'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'os-closed'; id: string };

export type NoeDesktopApi = {
  updater: {
    check: () => Promise<{ ok: boolean }>;
    download: () => Promise<{ ok: boolean }>;
    install: () => Promise<{ ok: boolean }>;
    onOpen: (handler: (payload: { reason?: string; version?: string }) => void) => () => void;
    onEvent: (handler: (event: UpdaterEvent) => void) => () => void;
  };
  editor: {
    open: (payload: {
      id: string;
      title?: string;
      width?: number;
      height?: number;
      state?: DesktopEditorState;
    }) => Promise<{ ok: boolean; reused?: boolean }>;
    push: (payload: { id: string; state: DesktopEditorState }) => Promise<{ ok: boolean }>;
    focus: (payload: { id: string }) => Promise<{ ok: boolean }>;
    hide: (payload: { id: string }) => Promise<{ ok: boolean }>;
    destroy: (payload: { id: string }) => Promise<{ ok: boolean }>;
    send: (payload: DesktopEditorChildMessage) => void;
    onFromChild: (handler: (payload: DesktopEditorChildMessage) => void) => () => void;
    onState: (handler: (state: DesktopEditorState) => void) => () => void;
    onRequestClose: (handler: (payload: Record<string, unknown>) => void) => () => void;
  };
};

declare global {
  interface Window {
    noeDesktop?: NoeDesktopApi;
  }
}

export function getDesktopApi(): NoeDesktopApi | null {
  return typeof window !== 'undefined' && window.noeDesktop ? window.noeDesktop : null;
}

export function getDetachedEditorId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('noeEditor');
  return id && id.trim() ? id.trim() : null;
}

export function toDesktopEditorState(editor: {
  id: string;
  sessionId: string;
  path: string;
  content: string;
  original: string;
  size: number;
  mtime: number | null;
  saving: boolean;
  dirty: boolean;
  zIndex: number;
}): DesktopEditorState {
  return {
    id: editor.id,
    sessionId: editor.sessionId,
    path: editor.path,
    content: editor.content,
    original: editor.original,
    size: editor.size,
    mtime: editor.mtime,
    saving: editor.saving,
    dirty: editor.dirty,
    zIndex: editor.zIndex,
  };
}
