export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version?: string; detail?: string }
  | { type: 'not-available'; version?: string; manual?: boolean }
  | { type: 'downloading' }
  | { type: 'progress'; percent: number; transferred?: number; total?: number; bytesPerSecond?: number }
  | { type: 'downloaded'; version?: string }
  | { type: 'error'; message: string; code?: string };

export type NoeDesktopApi = {
  updater: {
    check: () => Promise<{ ok: boolean }>;
    download: () => Promise<{ ok: boolean }>;
    install: () => Promise<{ ok: boolean }>;
    onOpen: (handler: (payload: { reason?: string; version?: string }) => void) => () => void;
    onEvent: (handler: (event: UpdaterEvent) => void) => () => void;
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
