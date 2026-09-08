import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, {
  DiffEditor,
  type DiffOnMount,
  type Monaco,
  type OnMount
} from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  FileCode2,
  LoaderCircle,
  ScanSearch,
  Sparkles,
  SplitSquareHorizontal,
  WrapText,
  X
} from "lucide-react";

import "./monaco-environment";
import { readCommitFile, readFile, readWorkingFile } from "./api";
import {
  diffModelUri,
  disposeClosedModels,
  ensureDiffModels,
  ensureFileModel,
  fileModelUri
} from "./editor-models";
import { entireFileRequest, readCodeSelection } from "./selection";
import type {
  AiCodeAction,
  CodeSelection,
  DocumentTab,
  FileComparison,
  FileView,
  WorkspaceSummary
} from "./types";

interface EditorPaneProps {
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onAiAction: (action: AiCodeAction, selection: CodeSelection) => void;
  onClose: (id: string) => void;
  revision: number;
  tabs: DocumentTab[];
  theme: "dark" | "light";
  workspace: WorkspaceSummary | null;
}

const editorOptions = {
  automaticLayout: true,
  contextmenu: false,
  fontFamily: '"Berkeley Mono", "SFMono-Regular", Menlo, Consolas, monospace',
  fontLigatures: true,
  fontSize: 13,
  lineHeight: 21,
  minimap: { enabled: false },
  padding: { top: 18, bottom: 18 },
  readOnly: true,
  renderWhitespace: "selection" as const,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  wordWrap: "off" as const
};

export function EditorPane({
  activeTabId,
  onActivate,
  onAiAction,
  onClose,
  revision,
  tabs,
  theme,
  workspace
}: EditorPaneProps) {
  const tab = tabs.find((item) => item.id === activeTabId) ?? null;
  const [file, setFile] = useState<FileView | null>(null);
  const [comparison, setComparison] = useState<FileComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sideBySide, setSideBySide] = useState(
    () => window.localStorage.getItem("lcoder.diff.side-by-side") !== "false"
  );
  const [selection, setSelection] = useState<CodeSelection | null>(null);
  const [activeEditor, setActiveEditor] = useState<{
    instance: editor.ICodeEditor;
    side: CodeSelection["side"];
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    request: CodeSelection;
  } | null>(null);
  const selectionSubscriptions = useRef<{ dispose: () => void }[]>([]);
  const previousWorkspaceId = useRef<string | null>(null);
  const language = useMemo(() => languageForPath(tab?.path ?? ""), [tab?.path]);

  const disposeSelectionSubscriptions = useCallback(() => {
    for (const subscription of selectionSubscriptions.current) {
      subscription.dispose();
    }
    selectionSubscriptions.current = [];
  }, []);

  const captureSelectionValue = useCallback(
    (editorInstance: editor.ICodeEditor, side: CodeSelection["side"]) => {
      setSelection(
        tab ? readCodeSelection(editorInstance, tab, language, side) : null
      );
    },
    [language, tab]
  );

  const registerSelectionActions = useCallback(
    (
      editorInstance: editor.IStandaloneCodeEditor,
      monaco: Monaco,
      side: CodeSelection["side"]
    ) => {
      if (!tab) return;
      const explainSelection = () => {
        captureSelectionValue(editorInstance, side);
        const selected = readCodeSelection(editorInstance, tab, language, side);
        if (selected) onAiAction("explain", selected);
      };
      const explainEntireFile = () => {
        onAiAction("explain", entireFileRequest(editorInstance, tab, language, side));
      };
      const editorNode = editorInstance.getDomNode();
      const openContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const selected = readCodeSelection(editorInstance, tab, language, side);
        setActiveEditor({ instance: editorInstance, side });
        setSelection(selected);
        setContextMenu({
          x: Math.min(event.clientX, window.innerWidth - 230),
          y: Math.min(event.clientY, window.innerHeight - 92),
          request:
            selected ?? entireFileRequest(editorInstance, tab, language, side)
        });
      };
      editorNode?.addEventListener("contextmenu", openContextMenu, true);
      selectionSubscriptions.current.push(
        editorInstance.onDidChangeCursorSelection(() =>
          captureSelectionValue(editorInstance, side)
        ),
        editorInstance.onDidFocusEditorText(() => {
          setActiveEditor({ instance: editorInstance, side });
          captureSelectionValue(editorInstance, side);
        }),
        editorInstance.addAction({
          id: `lcoder.explain-selection.${side}`,
          label: "AI: Explain Selection",
          keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE
          ],
          precondition: "editorHasSelection",
          run: explainSelection
        }),
        editorInstance.addAction({
          id: `lcoder.explain-entire-file.${side}`,
          label: "AI: Explain Entire File",
          keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE
          ],
          precondition: "!editorHasSelection",
          run: explainEntireFile
        }),
        {
          dispose() {
            editorNode?.removeEventListener("contextmenu", openContextMenu, true);
          }
        }
      );
      setActiveEditor({ instance: editorInstance, side });
      captureSelectionValue(editorInstance, side);
    },
    [captureSelectionValue, language, onAiAction, tab]
  );

  const mountEditor = useCallback<OnMount>(
    (editorInstance, monaco) => {
      disposeSelectionSubscriptions();
      registerSelectionActions(editorInstance, monaco, "file");
    },
    [disposeSelectionSubscriptions, registerSelectionActions]
  );

  const mountDiffEditor = useCallback<DiffOnMount>(
    (diffEditor, monaco) => {
      disposeSelectionSubscriptions();
      registerSelectionActions(diffEditor.getOriginalEditor(), monaco, "original");
      registerSelectionActions(diffEditor.getModifiedEditor(), monaco, "modified");
    },
    [disposeSelectionSubscriptions, registerSelectionActions]
  );

  useEffect(() => {
    setSelection(null);
    setActiveEditor(null);
    setContextMenu(null);
  }, [tab?.id]);

  useEffect(() => {
    return () => {
      disposeSelectionSubscriptions();
    };
  }, [disposeSelectionSubscriptions]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".editor-ai-menu")) {
        setContextMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    setFile(null);
    setComparison(null);
    setError(null);
    if (!workspace || !tab) return;
    let cancelled = false;
    setLoading(true);
    const request =
      tab.kind === "file"
        ? readFile(workspace.id, tab.path).then((result) => {
            if (!cancelled) setFile(result);
          })
        : tab.kind === "workingDiff"
          ? readWorkingFile(workspace.id, tab.change).then((result) => {
              if (!cancelled) setComparison(result);
            })
          : readCommitFile(workspace.id, tab.commit, tab.change).then((result) => {
              if (!cancelled) setComparison(result);
            });
    void request
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, tab, workspace]);

  useEffect(() => {
    const workspaceId = workspace?.id ?? null;
    const previous = previousWorkspaceId.current;
    if (previous && previous !== workspaceId) {
      disposeClosedModels(previous, []);
    }
    previousWorkspaceId.current = workspaceId;
    if (!workspaceId) return;
    const timer = window.setTimeout(
      () => disposeClosedModels(workspaceId, tabs.map((item) => item.id)),
      0
    );
    return () => window.clearTimeout(timer);
  }, [tabs, workspace?.id]);

  useEffect(
    () => () => {
      if (previousWorkspaceId.current) {
        disposeClosedModels(previousWorkspaceId.current, []);
      }
    },
    []
  );

  useEffect(() => {
    if (!workspace || !tab) return;
    if (file?.kind === "text") {
      ensureFileModel(workspace.id, tab.id, language, file.content);
    } else if (comparison?.kind === "text") {
      ensureDiffModels(
        workspace.id,
        tab.id,
        language,
        comparison.original,
        comparison.modified
      );
    }
  }, [comparison, file, language, tab, workspace]);

  if (!workspace) {
    return (
      <section className="empty-editor" aria-label="Code viewer">
        <div className="empty-editor-mark">
          <span>LC</span>
        </div>
        <p className="eyebrow">LOCAL CODE WORKBENCH</p>
        <h1>Read the code.<br />Interrogate the change.</h1>
        <p className="empty-copy">
          Open a directory to browse source, review local Git changes, and work beside a real AI
          terminal.
        </p>
      </section>
    );
  }

  return (
    <section className="editor-shell" aria-label="Code viewer">
      <div className="tab-strip" role="tablist" aria-label="Open files">
        {tabs.length === 0 ? <span className="tab-strip-empty">NO OPEN FILES</span> : null}
        {tabs.map((item) => (
          <div
            className={`document-tab ${item.id === activeTabId ? "active" : ""}`}
            key={item.id}
          >
            <button
              aria-selected={item.id === activeTabId}
              className="document-tab-activate"
              onClick={() => onActivate(item.id)}
              role="tab"
              type="button"
            >
              <FileCode2 size={13} />
              <span>{item.title}</span>
            </button>
            <button
              aria-label={`Close ${item.title}`}
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(item.id);
              }}
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {tab ? (
        <div className="breadcrumb">
          <span>{workspace.name}</span>
          <span className="breadcrumb-separator">/</span>
          <strong>{tab.path}</strong>
          {comparison ? (
            <span className={`change-pill status-${comparison.status}`}>
              {statusLabel(comparison.status)}
            </span>
          ) : null}
          {comparison ? (
            <button
              aria-label={sideBySide ? "Use inline diff" : "Use split diff"}
              className="icon-button diff-layout-toggle"
              onClick={() => {
                const next = !sideBySide;
                setSideBySide(next);
                window.localStorage.setItem("lcoder.diff.side-by-side", String(next));
              }}
              title={sideBySide ? "Use inline diff" : "Use split diff"}
              type="button"
            >
              {sideBySide ? <WrapText size={14} /> : <SplitSquareHorizontal size={14} />}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="editor-stage">
        {!tab ? (
          <div className="stage-placeholder">
            <FileCode2 size={28} strokeWidth={1.4} />
            <p>Select a file from the navigator.</p>
            <span>Browse source or switch to Review for a focused change set.</span>
          </div>
        ) : loading ? (
          <div className="stage-placeholder">
            <LoaderCircle className="spin" size={22} />
            <p>Loading {tab.title}</p>
          </div>
        ) : error ? (
          <EditorMessage title="Unable to open file" detail={error} />
        ) : file?.kind === "unsupported" ? (
          <EditorMessage title="Preview unavailable" detail={file.reason} />
        ) : comparison?.kind === "unsupported" ? (
          <EditorMessage title="Diff unavailable" detail={comparison.reason} />
        ) : file?.kind === "text" ? (
          <Editor
            key={tab.id}
            height="100%"
            keepCurrentModel
            language={language}
            options={editorOptions}
            onMount={mountEditor}
            path={fileModelUri(workspace.id, tab.id).toString()}
            theme={theme === "dark" ? "vs-dark" : "vs"}
          />
        ) : comparison?.kind === "text" ? (
          <DiffEditor
            key={tab.id}
            height="100%"
            keepCurrentModifiedModel
            keepCurrentOriginalModel
            language={language}
            modifiedModelPath={diffModelUri(workspace.id, tab.id, "modified").toString()}
            options={{
              ...editorOptions,
              enableSplitViewResizing: true,
              originalEditable: false,
              renderSideBySide: sideBySide
            }}
            onMount={mountDiffEditor}
            originalModelPath={diffModelUri(workspace.id, tab.id, "original").toString()}
            theme={theme === "dark" ? "vs-dark" : "vs"}
          />
        ) : null}
        {contextMenu ? (
          <div
            aria-label="AI code actions"
            className="editor-ai-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                onAiAction("explain", contextMenu.request);
                setContextMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <Sparkles size={14} />
              {contextMenu.request.scope === "selection"
                ? "AI: Explain Selection"
                : "AI: Explain Entire File"}
              <kbd>⌘⇧E</kbd>
            </button>
            <button
              onClick={() => {
                onAiAction("review", contextMenu.request);
                setContextMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <ScanSearch size={14} />
              {contextMenu.request.scope === "selection"
                ? "AI: Review Selection"
                : "AI: Review Entire File"}
            </button>
          </div>
        ) : null}
      </div>

      <footer className="editor-status">
        <span>
          {selection
            ? `Selected L${selection.startLine}–L${selection.endLine}${selection.truncated ? " · clipped" : ""}`
            : tab?.path ?? "No file selected"}
        </span>
        <button
          className="explain-selection-button"
          onClick={() => {
            if (!tab || !activeEditor) return;
            onAiAction(
              "explain",
              selection ??
                entireFileRequest(
                  activeEditor.instance,
                  tab,
                  language,
                  activeEditor.side
                )
            );
          }}
          disabled={!tab || !activeEditor}
          title={
            selection
              ? "Explain selection in AI Terminal (⌘⇧E)"
              : "Explain entire file in AI Terminal (⌘⇧E)"
          }
          type="button"
        >
          <Sparkles size={12} />
          {selection ? "Explain selection" : "Explain entire file"}
          <kbd>⌘⇧E</kbd>
        </button>
        <span>{comparison?.baseline ?? "UTF-8 · READ ONLY"}</span>
      </footer>
    </section>
  );
}

function EditorMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="stage-placeholder">
      <FileCode2 size={28} strokeWidth={1.4} />
      <p>{title}</p>
      <span>{detail}</span>
    </div>
  );
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    {
      c: "c",
      cc: "cpp",
      cpp: "cpp",
      css: "css",
      go: "go",
      html: "html",
      java: "java",
      js: "javascript",
      json: "json",
      jsx: "javascript",
      md: "markdown",
      py: "python",
      rs: "rust",
      sh: "shell",
      toml: "ini",
      ts: "typescript",
      tsx: "typescript",
      yaml: "yaml",
      yml: "yaml"
    }[extension ?? ""] ?? "plaintext"
  );
}

export function statusLabel(status: string): string {
  return (
    {
      added: "A",
      copied: "C",
      deleted: "D",
      modified: "M",
      renamed: "R",
      typeChanged: "T",
      unmerged: "U",
      untracked: "?"
    }[status] ?? "•"
  );
}
