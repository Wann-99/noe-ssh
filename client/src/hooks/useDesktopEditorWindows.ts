import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import {
  getDesktopApi,
  toDesktopEditorState,
  type DesktopEditorChildMessage,
} from '../lib/desktop';

/**
 * On Electron desktop, each open editor uses a real OS window
 * that can move/resize across the desktop.
 */
export function useDesktopEditorWindows(options: {
  onRequestClose: (id: string) => void;
}) {
  const editors = useAppStore((s) => s.editors);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const setEditorContent = useAppStore((s) => s.setEditorContent);
  const saveEditor = useAppStore((s) => s.saveEditor);
  const closeEditor = useAppStore((s) => s.closeEditor);
  const minimizeEditor = useAppStore((s) => s.minimizeEditor);
  const focusEditor = useAppStore((s) => s.focusEditor);
  const openIdsRef = useRef(new Set<string>());
  const lastMetaRef = useRef(new Map<string, string>());
  const { onRequestClose } = options;
  const activeEditorId = sessions.find((item) => item.id === activeSessionId)?.activeEditorId || null;

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.editor) return undefined;

    const off = api.editor.onFromChild((msg: DesktopEditorChildMessage) => {
      if (!msg || !msg.id) return;
      switch (msg.type) {
        case 'ready': {
          const editor = useAppStore.getState().editors.find((item) => item.id === msg.id);
          if (editor && !editor.minimized) {
            void api.editor.push({ id: msg.id, state: toDesktopEditorState(editor) });
          }
          break;
        }
        case 'change':
          setEditorContent(msg.id, msg.content);
          break;
        case 'save':
          if (typeof msg.content === 'string') setEditorContent(msg.id, msg.content);
          saveEditor(msg.id);
          break;
        case 'close':
          if (msg.force) {
            closeEditor(msg.id, true);
            void api.editor.destroy({ id: msg.id });
            openIdsRef.current.delete(msg.id);
            lastMetaRef.current.delete(msg.id);
          } else {
            onRequestClose(msg.id);
          }
          break;
        case 'minimize':
          minimizeEditor(msg.id);
          openIdsRef.current.delete(msg.id);
          lastMetaRef.current.delete(msg.id);
          break;
        case 'focus':
          focusEditor(msg.id);
          break;
        case 'os-closed':
          openIdsRef.current.delete(msg.id);
          lastMetaRef.current.delete(msg.id);
          break;
        default:
          break;
      }
    });
    return off;
  }, [
    closeEditor,
    focusEditor,
    minimizeEditor,
    onRequestClose,
    saveEditor,
    setEditorContent,
  ]);

  const openSignature = editors
    .filter((editor) => !editor.minimized)
    .map((editor) => editor.id)
    .sort()
    .join('|');

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.editor) return;

    const openEditors = useAppStore.getState().editors.filter((editor) => !editor.minimized);
    const openIds = new Set(openEditors.map((editor) => editor.id));

    for (const editor of openEditors) {
      if (!openIdsRef.current.has(editor.id)) {
        openIdsRef.current.add(editor.id);
        void api.editor.open({
          id: editor.id,
          title: editor.path.split('/').pop() || 'Editor',
          state: toDesktopEditorState(editor),
        });
      }
    }

    for (const id of [...openIdsRef.current]) {
      if (!openIds.has(id)) {
        openIdsRef.current.delete(id);
        lastMetaRef.current.delete(id);
        void api.editor.destroy({ id });
      }
    }
  }, [openSignature]);

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.editor || !activeEditorId) return;
    if (!openIdsRef.current.has(activeEditorId)) return;
    void api.editor.focus({ id: activeEditorId });
  }, [activeEditorId]);

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.editor) return;
    for (const editor of editors) {
      if (editor.minimized || !openIdsRef.current.has(editor.id)) continue;
      const meta = [
        editor.saving ? '1' : '0',
        editor.dirty ? '1' : '0',
        editor.original,
        editor.path,
        String(editor.mtime ?? ''),
        String(editor.size),
      ].join('\n');
      if (lastMetaRef.current.get(editor.id) === meta) continue;
      lastMetaRef.current.set(editor.id, meta);
      void api.editor.push({ id: editor.id, state: toDesktopEditorState(editor) });
    }
  }, [editors]);
}

export function isDesktopEditorHost() {
  return Boolean(getDesktopApi()?.editor) && !new URLSearchParams(window.location.search).get('noeEditor');
}
