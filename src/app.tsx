import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Braces,
  ChevronRight,
  Code2,
  FolderOpen,
  GitBranch,
  GitPullRequestArrow,
  RefreshCw,
  ShieldCheck,
  ShieldQuestion,
  SunMoon,
  TerminalSquare
} from "lucide-react";

import {
  chooseWorkspace,
  readRepository,
  restoreWorkspace,
  setWorkspaceTrusted,
  watchWorkspace
} from "./api";
import { resizePane } from "./layout";
import { Navigator } from "./navigator";
import { TerminalPane } from "./terminal-pane";
import type {
  AiCodeAction,
  AiCodeRequest,
  CodeSelection,
  DocumentTab,
  RepositorySummary,
  WorkspaceSummary
} from "./types";

const EditorPane = lazy(() =>
  import("./editor-pane").then((module) => ({ default: module.EditorPane }))
);

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [mode, setMode] = useState<"browse" | "review">("browse");
  const [tabs, setTabs] = useState<DocumentTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(
    () => Number(window.localStorage.getItem("lcoder.left-width")) || 240
  );
  const [rightWidth, setRightWidth] = useState(
    () => Number(window.localStorage.getItem("lcoder.right-width")) || 430
  );
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (window.localStorage.getItem("lcoder.theme.v2") as "dark" | "light") || "light"
  );
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [compactTerminalOpen, setCompactTerminalOpen] = useState(false);
  const [aiCodeRequest, setAiCodeRequest] = useState<AiCodeRequest | null>(null);
  const revisionRef = useRef(0);
  const aiCodeRequestId = useRef(0);
  const workspaceSelectionGeneration = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("lcoder.theme.v2", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("lcoder.left-width", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    window.localStorage.setItem("lcoder.right-width", String(rightWidth));
  }, [rightWidth]);

  useEffect(() => {
    const generation = workspaceSelectionGeneration.current;
    void restoreWorkspace()
      .then((restored) => {
        if (generation === workspaceSelectionGeneration.current) {
          setWorkspace(restored);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!workspace) {
      setRepository(null);
      return;
    }
    let cancelled = false;
    void readRepository(workspace.id)
      .then((summary) => {
        if (!cancelled) setRepository(summary);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [revision, workspace]);

  useEffect(() => {
    if (!workspace) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void watchWorkspace(workspace.id, revisionRef.current)
        .then((state) => {
          if (stopped || !state.changed) return;
          revisionRef.current = state.revision;
          setRevision(state.revision);
        })
        .catch(() => undefined);
    }, 800);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [workspace]);

  const openWorkspace = async () => {
    if (
      terminalRunning &&
      !window.confirm("Changing workspace will stop the active terminal. Continue?")
    ) {
      return;
    }
    const generation = ++workspaceSelectionGeneration.current;
    try {
      const selected = await chooseWorkspace();
      if (generation !== workspaceSelectionGeneration.current) return;
      if (!selected) {
        const recent = await restoreWorkspace();
        if (generation === workspaceSelectionGeneration.current) {
          setWorkspace(recent);
        }
        return;
      }
      setWorkspace(selected);
      setTabs([]);
      setActiveTabId(null);
      setAiCodeRequest(null);
      revisionRef.current = 0;
      setRevision(0);
      setError(null);
      setCompactTerminalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const openTab = useCallback((tab: DocumentTab) => {
    setTabs((current) =>
      current.some((candidate) => candidate.id === tab.id) ? current : [...current, tab]
    );
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.id === id);
        const next = current.filter((tab) => tab.id !== id);
        if (activeTabId === id) {
          setActiveTabId(next[Math.min(index, next.length - 1)]?.id ?? null);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const refresh = () => {
    const next = revisionRef.current + 1;
    revisionRef.current = next;
    setRevision(next);
  };

  const requestAiAction = useCallback((action: AiCodeAction, selection: CodeSelection) => {
    setCompactTerminalOpen(true);
    setAiCodeRequest({
      id: ++aiCodeRequestId.current,
      action,
      selection
    });
  }, []);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <div className="app" style={{ "--left-width": `${leftWidth}px`, "--right-width": `${rightWidth}px` } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Braces size={18} strokeWidth={2.1} />
          </div>
          <div>
            <strong>LCoder</strong>
            <span>LOCAL REVIEW WORKBENCH</span>
          </div>
        </div>

        <button className="workspace-switcher" onClick={() => void openWorkspace()} type="button">
          <FolderOpen size={15} />
          {workspace ? (
            <span>
              <strong>{workspace.name}</strong>
              <small>{workspace.path}</small>
            </span>
          ) : (
            <span>
              <strong>Open workspace</strong>
              <small>Choose a local code directory</small>
            </span>
          )}
          <ChevronRight size={14} />
        </button>

        <div className="mode-switch segmented" aria-label="Workspace mode">
          <button className={mode === "browse" ? "selected" : ""} onClick={() => setMode("browse")} type="button">
            <Code2 size={13} /> Browse
          </button>
          <button className={mode === "review" ? "selected" : ""} onClick={() => setMode("review")} type="button">
            <GitPullRequestArrow size={13} /> Review
          </button>
        </div>

        <div className="topbar-spacer" />
        {repository?.isRepository ? (
          <div className="branch-indicator">
            <GitBranch size={13} />
            <span>{repository.branch ?? "Detached HEAD"}</span>
            {repository.dirtyFiles ? <b>{repository.dirtyFiles}</b> : null}
          </div>
        ) : null}
        {workspace ? (
          <button
            className={`trust-button ${workspace.trusted ? "trusted" : ""}`}
            onClick={() => {
              if (
                !window.confirm(
                  workspace.trusted
                    ? "Revoke trust for this workspace? Any active terminal will stop."
                    : "Trusting this workspace allows Shell and AI terminals to execute its code. Continue?"
                )
              ) {
                return;
              }
              void setWorkspaceTrusted(workspace.id, !workspace.trusted)
                .then(setWorkspace)
                .catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : String(reason))
                );
            }}
            type="button"
          >
            {workspace.trusted ? <ShieldCheck size={13} /> : <ShieldQuestion size={13} />}
            {workspace.trusted ? "Trusted" : "Read only"}
          </button>
        ) : null}
        <button className="icon-button top-icon" onClick={refresh} title="Refresh workspace" type="button">
          <RefreshCw size={14} />
        </button>
        <button
          className="icon-button top-icon"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          title="Toggle theme"
          type="button"
        >
          <SunMoon size={14} />
        </button>
        <button
          aria-label="Toggle terminal"
          className="icon-button top-icon compact-terminal-toggle"
          onClick={() => setCompactTerminalOpen((current) => !current)}
          title="Toggle terminal"
          type="button"
        >
          <TerminalSquare size={14} />
        </button>
      </header>

      {error ? (
        <div className="global-error">
          <span>{error}</span>
          <button onClick={() => setError(null)} type="button">Dismiss</button>
        </div>
      ) : null}
      {workspace?.warning ? <div className="workspace-warning">{workspace.warning}</div> : null}

      <main className="workbench">
        <section className="left-panel" style={{ width: leftWidth }}>
          {workspace ? (
            <Navigator
              activeTab={activeTab}
              key={`${workspace.id}:${mode}`}
              mode={mode}
              onOpen={openTab}
              repository={repository}
              revision={revision}
              workspace={workspace}
            />
          ) : (
            <div className="navigator no-workspace">
              <div className="navigator-empty">
                <FolderOpen size={27} />
                <p>No workspace open</p>
                <span>Choose a local directory to begin.</span>
                <button className="primary-button" onClick={() => void openWorkspace()} type="button">
                  Open directory
                </button>
              </div>
            </div>
          )}
        </section>

        <ResizeHandle
          label="Resize navigator"
          onChange={(delta) =>
            setLeftWidth((current) => resizePane(current, delta, 200, 420))
          }
        />

        <div className="center-panel">
          <Suspense fallback={<div className="editor-loading">Loading code viewer…</div>}>
            <EditorPane
              activeTabId={activeTabId}
              onActivate={setActiveTabId}
              onClose={closeTab}
              onAiAction={requestAiAction}
              revision={revision}
              tabs={tabs}
              theme={theme}
              workspace={workspace}
            />
          </Suspense>
        </div>

        <ResizeHandle
          label="Resize terminal"
          onChange={(delta) =>
            setRightWidth((current) => resizePane(current, delta, 300, 620, -1))
          }
        />

        <section
          className={`right-panel ${compactTerminalOpen ? "compact-open" : ""}`}
          style={{ width: rightWidth }}
        >
          <TerminalPane
            aiCodeRequest={aiCodeRequest}
            key={workspace?.id ?? "no-workspace"}
            onRunningChange={setTerminalRunning}
            onWorkspaceChange={setWorkspace}
            theme={theme}
            workspace={workspace}
          />
        </section>
      </main>
    </div>
  );
}

function ResizeHandle({
  label,
  onChange
}: {
  label: string;
  onChange: (delta: number) => void;
}) {
  const last = useRef(0);
  const start = (clientX: number) => {
    last.current = clientX;
    const move = (event: PointerEvent) => {
      const delta = event.clientX - last.current;
      last.current = event.clientX;
      onChange(delta);
    };
    const stop = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      className="resize-handle"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onChange(-8);
        if (event.key === "ArrowRight") onChange(8);
      }}
      onPointerDown={(event) => start(event.clientX)}
      role="separator"
      tabIndex={0}
    />
  );
}
