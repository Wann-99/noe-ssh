import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react';
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
import {
  findNext,
  findPrevious,
  highlightSelectionMatches,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
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

/** DESIGN.md (Linear): desaturated syntax colors on the near-black canvas. */
const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#b083f0' },
  { tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: '#b083f0' },
  { tag: t.comment, color: '#7d8590', fontStyle: 'italic' },
  { tag: t.docComment, color: '#7d8590', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: '#7bc97e' },
  { tag: t.character, color: '#7bc97e' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null], color: '#e8956d' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#97a9f0' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#97a9f0' },
  { tag: t.variableName, color: '#d0d6e0' },
  { tag: t.propertyName, color: '#8fd0e0' },
  { tag: [t.typeName, t.className, t.namespace], color: '#f0c060' },
  { tag: [t.tagName, t.angleBracket], color: '#f0706a' },
  { tag: t.attributeName, color: '#f0c060' },
  { tag: t.attributeValue, color: '#7bc97e' },
  { tag: [t.operator, t.punctuation, t.separator], color: '#8fd0e0' },
  { tag: t.regexp, color: '#8fd0e0' },
  { tag: t.meta, color: '#8a8f98' },
  { tag: t.link, color: '#6cb6c9', textDecoration: 'underline' },
  { tag: t.heading, color: '#97a9f0', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: '#f0706a' },
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: '#d0d6e0',
    backgroundColor: '#0f1011',
    fontSize: '13px',
  },
  '.cm-content': {
    caretColor: '#828fff',
    fontFamily: 'var(--font-mono)',
    padding: '10px 0 28px',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#828fff' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    color: '#62666d',
    backgroundColor: '#0f1011',
    borderRight: '1px solid #23252a',
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(94, 106, 210, 0.14)', color: '#d0d6e0' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(94, 106, 210, 0.35) !important',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#18191a',
    border: '1px solid #34343a',
    color: '#d0d6e0',
  },
  '.cm-tooltip': {
    backgroundColor: '#18191a',
    border: '1px solid #34343a',
    color: '#d0d6e0',
  },
  '.cm-panels': { display: 'none' },
  '.cm-searchMatch': { backgroundColor: 'rgba(240, 192, 96, 0.35)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(94, 106, 210, 0.45)' },
}, { dark: true });

export type CodeEditorHandle = {
  openSearch: () => void;
  focus: () => void;
};

export const CodeEditor = forwardRef<CodeEditorHandle, {
  editor: EditorFile;
  onChange: (content: string) => void;
  onSave: () => void;
  onCursorChange: (line: number, column: number) => void;
}>(function CodeEditor({
  editor,
  onChange,
  onSave,
  onCursorChange,
}, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursorChange);
  const openSearchRef = useRef<() => void>(() => undefined);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorRef.current = onCursorChange;

  const [searchOpen, setSearchOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegexp, setUseRegexp] = useState(false);
  const [showReplace, setShowReplace] = useState(false);

  const applyQuery = (searchValue = findText, replaceValue = replaceText) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: searchValue,
        replace: replaceValue,
        caseSensitive: matchCase,
        regexp: useRegexp,
        wholeWord,
      })),
    });
  };

  openSearchRef.current = () => {
    setSearchOpen(true);
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
  };

  useImperativeHandle(ref, () => ({
    openSearch: () => openSearchRef.current(),
    focus: () => viewRef.current?.focus(),
  }), []);

  useEffect(() => {
    if (!searchOpen) return;
    applyQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, matchCase, wholeWord, useRegexp]);

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
    const findKeymap = {
      key: 'Mod-f',
      preventDefault: true,
      run: () => {
        openSearchRef.current();
        return true;
      },
    };
    const replaceKeymap = {
      key: 'Mod-h',
      preventDefault: true,
      run: () => {
        setShowReplace(true);
        openSearchRef.current();
        return true;
      },
    };
    const copySelection = (view: EditorView) => {
      const { state: st } = view;
      const text = st.selection.ranges
        .map((range) => st.sliceDoc(range.from, range.to))
        .join(st.lineBreak);
      if (!text) return false;
      void navigator.clipboard.writeText(text).catch(() => undefined);
      return true;
    };
    const clipboardKeymap = [
      {
        key: 'Mod-c',
        preventDefault: true,
        run: (view: EditorView) => copySelection(view),
      },
      {
        key: 'Mod-x',
        preventDefault: true,
        run: (view: EditorView) => {
          if (view.state.readOnly) return false;
          if (!copySelection(view)) return false;
          view.dispatch(view.state.replaceSelection(''));
          return true;
        },
      },
      {
        key: 'Mod-v',
        preventDefault: true,
        run: (view: EditorView) => {
          if (view.state.readOnly) return false;
          void navigator.clipboard.readText()
            .then((text) => {
              if (!text || !viewRef.current) return;
              viewRef.current.dispatch(viewRef.current.state.replaceSelection(text));
              viewRef.current.focus();
            })
            .catch(() => undefined);
          return true;
        },
      },
    ];
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
        search({ top: true }),
        EditorView.lineWrapping,
        keymap.of([
          saveKeymap,
          findKeymap,
          replaceKeymap,
          ...clipboardKeymap,
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
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
    viewRef.current = view;
    let cancelled = false;
    loadLanguage(editor.path).then((extension) => {
      if (!cancelled) view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
    });
    view.focus();
    return () => {
      cancelled = true;
      viewRef.current = null;
      view.destroy();
    };
  }, [editor.id, editor.path]);

  const runFind = (direction: 'next' | 'previous') => {
    const view = viewRef.current;
    if (!view || !findText) return;
    applyQuery();
    if (direction === 'next') findNext(view);
    else findPrevious(view);
  };

  return (
    <div className="code-editor-shell">
      {searchOpen && (
        <div className="editor-search" role="search">
          <div className="editor-search-row">
            <Search size={14} className="editor-search-icon" aria-hidden />
            <input
              ref={findInputRef}
              className="editor-search-input"
              value={findText}
              placeholder="查找"
              onChange={(event) => {
                const value = event.target.value;
                setFindText(value);
                applyQuery(value, replaceText);
                if (value) {
                  const view = viewRef.current;
                  if (view) findNext(view);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  runFind(event.shiftKey ? 'previous' : 'next');
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSearchOpen(false);
                  viewRef.current?.focus();
                }
              }}
            />
            <button type="button" className="icon-button" title="上一个" aria-label="上一个" onClick={() => runFind('previous')}>
              <ChevronUp size={14} />
            </button>
            <button type="button" className="icon-button" title="下一个" aria-label="下一个" onClick={() => runFind('next')}>
              <ChevronDown size={14} />
            </button>
            <label className="editor-search-check">
              <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
              <span>大小写</span>
            </label>
            <label className="editor-search-check">
              <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
              <span>整词</span>
            </label>
            <label className="editor-search-check">
              <input type="checkbox" checked={useRegexp} onChange={(e) => setUseRegexp(e.target.checked)} />
              <span>正则</span>
            </label>
            <button
              type="button"
              className={`icon-button ${showReplace ? 'is-active' : ''}`}
              title="替换"
              aria-label="切换替换"
              aria-pressed={showReplace}
              onClick={() => setShowReplace((open) => !open)}
            >
              <Replace size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="关闭"
              aria-label="关闭搜索"
              onClick={() => {
                setSearchOpen(false);
                viewRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          </div>
          {showReplace && (
            <div className="editor-search-row">
              <span className="editor-search-icon editor-search-icon-spacer" aria-hidden />
              <input
                className="editor-search-input"
                value={replaceText}
                placeholder="替换为"
                onChange={(event) => {
                  const value = event.target.value;
                  setReplaceText(value);
                  applyQuery(findText, value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const view = viewRef.current;
                    if (!view || !findText) return;
                    applyQuery();
                    replaceNext(view);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setSearchOpen(false);
                    viewRef.current?.focus();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!findText}
                onClick={() => {
                  const view = viewRef.current;
                  if (!view || !findText) return;
                  applyQuery();
                  replaceNext(view);
                }}
              >
                替换
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!findText}
                onClick={() => {
                  const view = viewRef.current;
                  if (!view || !findText) return;
                  applyQuery();
                  replaceAll(view);
                }}
              >
                全部替换
              </button>
            </div>
          )}
        </div>
      )}
      <div className="code-editor-host" ref={hostRef} />
    </div>
  );
});
