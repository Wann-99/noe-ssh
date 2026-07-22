import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import type { EditorFile } from '../store/appStore';

async function loadLanguage(path: string): Promise<Extension> {
  const filename = path.split('/').pop()?.toLowerCase() || '';
  const ext = filename.includes('.') ? filename.split('.').pop() || '' : '';
  if (ext === 'json' || ext === 'jsonc') return (await import('@codemirror/lang-json')).json();
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return (await import('@codemirror/lang-javascript')).javascript({ jsx: ext === 'jsx' });
  }
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) {
    return (await import('@codemirror/lang-javascript')).javascript({
      jsx: ext === 'tsx',
      typescript: true,
    });
  }
  if (ext === 'py' || filename === 'pythonfile') return (await import('@codemirror/lang-python')).python();
  if (['md', 'mdx', 'markdown'].includes(ext)) return (await import('@codemirror/lang-markdown')).markdown();
  if (['html', 'htm'].includes(ext)) return (await import('@codemirror/lang-html')).html();
  if (['css', 'scss', 'less'].includes(ext)) return (await import('@codemirror/lang-css')).css();
  if (['xml', 'svg', 'xsl'].includes(ext)) return (await import('@codemirror/lang-xml')).xml();
  if (ext === 'sql') return (await import('@codemirror/lang-sql')).sql();
  if (['yaml', 'yml'].includes(ext)) {
    const { yaml } = await import('@codemirror/legacy-modes/mode/yaml');
    return StreamLanguage.define(yaml);
  }
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext) || ['.bashrc', '.zshrc', '.profile'].includes(filename)) {
    const { shell } = await import('@codemirror/legacy-modes/mode/shell');
    return StreamLanguage.define(shell);
  }
  return [];
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface-editor)',
    fontSize: '13px',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    padding: '10px 0 28px',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    color: 'var(--text-faint)',
    backgroundColor: 'var(--surface-editor)',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-hover)', color: 'var(--text-secondary)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.025)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(43, 139, 255, .28) !important',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-secondary)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border-default)',
  },
  '.cm-panels': { backgroundColor: 'var(--surface-raised)', color: 'var(--text-primary)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(226, 174, 65, .3)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(43, 139, 255, .35)' },
}, { dark: true });

export function CodeEditor({
  editor,
  onChange,
  onSave,
  onCursorChange,
}: {
  editor: EditorFile;
  onChange: (content: string) => void;
  onSave: () => void;
  onCursorChange: (line: number, column: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursorChange);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorRef.current = onCursorChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const saveKeymap = {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        onSaveRef.current();
        return true;
      },
    };
    const state = EditorState.create({
      doc: editor.content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        keymap.of([
          saveKeymap,
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorRef.current(line.number, head - line.from + 1);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    let cancelled = false;
    loadLanguage(editor.path).then((extension) => {
      if (!cancelled) view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
    });
    view.focus();
    return () => {
      cancelled = true;
      view.destroy();
    };
  }, [editor.id, editor.path]);

  return <div className="code-editor-host" ref={hostRef} />;
}
