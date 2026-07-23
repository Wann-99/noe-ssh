/**
 * Previously opened each editor in a separate Electron BrowserWindow.
 * That path broke stash restore / absorb animations and could crash the app
 * on Linux minimize. Desktop now uses in-app EditorFloat (same as Web).
 *
 * Kept as a stub so imports do not break if referenced during transition.
 */
export function useDesktopEditorWindows(_options: {
  onRequestClose: (id: string) => void;
}) {
  /* no-op */
}

export function isDesktopEditorHost() {
  return false;
}
