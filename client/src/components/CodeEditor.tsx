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
  '.cm-panels': { display: 'none' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 203, 107, .35)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(130, 170, 255, .4)' },
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
