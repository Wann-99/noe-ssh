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
  HighlightStyle,
  foldGutter,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
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

/** Dark-friendly syntax colors (defaultHighlightStyle is for light themes). */
const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: '#c792ea' },
  { tag: t.comment, color: '#8b9bb4', fontStyle: 'italic' },
  { tag: t.docComment, color: '#8b9bb4', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: '#c3e88d' },
  { tag: t.character, color: '#c3e88d' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null], color: '#f78c6c' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#82aaff' },
  { tag: t.variableName, color: '#eef2ff' },
  { tag: t.propertyName, color: '#89ddff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#ffcb6b' },
  { tag: [t.tagName, t.angleBracket], color: '#f07178' },
  { tag: t.attributeName, color: '#ffcb6b' },
  { tag: t.attributeValue, color: '#c3e88d' },
  { tag: [t.operator, t.punctuation, t.separator], color: '#89ddff' },
  { tag: t.regexp, color: '#89ddff' },
  { tag: t.meta, color: '#a6accd' },
  { tag: t.link, color: '#80cbc4', textDecoration: 'underline' },
  { tag: t.heading, color: '#82aaff', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: '#ff5370' },
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: '#e8eefc',
    backgroundColor: '#0f141d',
    fontSize: '13px',
  },
  '.cm-content': {
    caretColor: '#82aaff',
    fontFamily: 'var(--font-mono)',
    padding: '10px 0 28px',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#82aaff' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    color: '#7f8ea3',
    backgroundColor: '#0f141d',
    borderRight: '1px solid rgba(255,255,255,.08)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(130,170,255,.12)', color: '#c5d0e6' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.04)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(130, 170, 255, .32) !important',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#1a2230',
    border: '1px solid rgba(255,255,255,.12)',
    color: '#c5d0e6',
  },
  '.cm-tooltip': {
    backgroundColor: '#1a2230',
    border: '1px solid rgba(255,255,255,.12)',
    color: '#e8eefc',
  },
  '.cm-panels': { backgroundColor: '#1a2230', color: '#e8eefc' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 203, 107, .35)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(130, 170, 255, .4)' },
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
        syntaxHighlighting(darkHighlightStyle, { fallback: true }),
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
