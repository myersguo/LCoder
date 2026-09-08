import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeRendererProps } from "react-arborist";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  File,
  FileDiff,
  Folder,
  FolderOpen,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw
} from "lucide-react";

import {
  listDirectory,
  readCommitChanges,
  readHistory,
  readWorkingChanges
} from "./api";
import { resizePane } from "./layout";
import { selectedBrowsePath, selectedReviewPath } from "./navigation-selection";
import { buildChangeTree, type ChangeTreeNode } from "./tree";
import type {
  CommitSummary,
  DirectoryEntry,
  DocumentTab,
  GitChange,
  RepositorySummary,
  WorkspaceSummary
} from "./types";

interface FileTreeNode {
  id: string;
  kind: DirectoryEntry["kind"] | "loadMore";
  name: string;
  path: string | null;
  children?: FileTreeNode[];
  message?: string | null;
  parentPath?: string;
  offset?: number;
}

function fileTreeNode(entry: DirectoryEntry): FileTreeNode {
  return {
    id: entry.path ? `${entry.kind}:${entry.path}` : `unsupported:${entry.name}`,
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    children: entry.kind === "directory" ? [] : undefined,
    message: entry.message
  };
}

function replaceChildren(
  nodes: FileTreeNode[],
  path: string,
  children: FileTreeNode[],
  append = false
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) {
      const current = append
        ? (node.children ?? []).filter((child) => child.kind !== "loadMore")
        : [];
      return { ...node, children: [...current, ...children] };
    }
    if (!node.children) return node;
    const next = replaceChildren(node.children, path, children, append);
    return next === node.children ? node : { ...node, children: next };
  });
}

function findFileNode(nodes: FileTreeNode[], id: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = node.children ? findFileNode(node.children, id) : null;
    if (nested) return nested;
  }
  return null;
}

interface NavigatorProps {
  activeTab: DocumentTab | null;
  mode: "browse" | "review";
  onOpen: (tab: DocumentTab) => void;
  repository: RepositorySummary | null;
  revision: number;
  workspace: WorkspaceSummary;
}

export function Navigator({
  activeTab,
  mode,
  onOpen,
  repository,
  revision,
  workspace
}: NavigatorProps) {
  if (mode === "browse") {
    return (
      <DirectoryBrowser
        activeTab={activeTab}
        onOpen={onOpen}
        revision={revision}
        workspace={workspace}
      />
    );
  }
  return (
    <ReviewBrowser
      activeTab={activeTab}
      onOpen={onOpen}
      repository={repository}
      revision={revision}
      workspace={workspace}
    />
  );
}

function DirectoryBrowser({
  activeTab,
  onOpen,
  revision,
  workspace
}: Pick<NavigatorProps, "activeTab" | "onOpen" | "revision" | "workspace">) {
  const [nodes, setNodes] = useState<FileTreeNode[]>([
    {
      id: "workspace-root",
      kind: "directory",
      name: workspace.name,
      path: "",
      children: []
    }
  ]);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set([""]));
  const [error, setError] = useState<string | null>(null);
  const [treeHeight, setTreeHeight] = useState(() => Math.max(100, window.innerHeight - 120));
  const loadGeneration = useRef(0);
  const loadingRequests = useRef(new Map<string, number>());
  const activePath = selectedBrowsePath(activeTab);

  const loadDirectory = useCallback(
    async (path: string, offset = 0) => {
      const requestKey = `${path}:${offset}`;
      if (loadingRequests.current.has(requestKey)) return;
      const generation = loadGeneration.current;
      loadingRequests.current.set(requestKey, generation);
      setLoadingPaths((current) => new Set(current).add(path));
      try {
        const page = await listDirectory(workspace.id, path, offset);
        if (generation !== loadGeneration.current) return;
        const children = page.entries.map(fileTreeNode);
        if (page.nextOffset !== null) {
          children.push({
            id: `load-more:${path}:${page.nextOffset}`,
            kind: "loadMore",
            name: "Load more…",
            path: null,
            parentPath: path,
            offset: page.nextOffset
          });
        }
        setNodes((current) => replaceChildren(current, path, children, offset > 0));
        setError(null);
      } catch (reason) {
        if (generation === loadGeneration.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (loadingRequests.current.get(requestKey) === generation) {
          loadingRequests.current.delete(requestKey);
        }
        if (generation === loadGeneration.current) {
          setLoadingPaths((current) => {
            const next = new Set(current);
            next.delete(path);
            return next;
          });
        }
      }
    },
    [workspace.id]
  );

  useEffect(() => {
    loadGeneration.current += 1;
    loadingRequests.current.clear();
    setLoadingPaths(new Set([""]));
    setNodes([
      {
        id: "workspace-root",
        kind: "directory",
        name: workspace.name,
        path: "",
        children: []
      }
    ]);
    void loadDirectory("");
  }, [loadDirectory, revision, workspace.name]);

  useEffect(() => {
    const update = () => setTreeHeight(Math.max(100, window.innerHeight - 120));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className="navigator">
      <PanelHeader eyebrow="WORKSPACE" title={workspace.name} />
      {error ? <TreeNote depth={0} text={error} /> : null}
      <div className="tree-scroll">
        <Tree<FileTreeNode>
          aria-label="Workspace files"
          data={nodes}
          disableDrag
          disableDrop
          disableMultiSelection
          height={treeHeight}
          idAccessor="id"
          indent={15}
          initialOpenState={{ "workspace-root": true }}
          onActivate={(node) => {
            if (
              node.data.kind === "loadMore" &&
              node.data.parentPath !== undefined &&
              node.data.offset !== undefined
            ) {
              void loadDirectory(node.data.parentPath, node.data.offset);
              return;
            }
            if (node.data.kind === "file" && node.data.path) {
              onOpen({
                id: `file:${node.data.path}`,
                kind: "file",
                path: node.data.path,
                title: node.data.name
              });
            } else if (node.data.kind === "directory") {
              node.toggle();
            }
          }}
          onToggle={(id) => {
            const node = findFileNode(nodes, id);
            if (node?.kind === "directory" && node.path !== null && node.children?.length === 0) {
              void loadDirectory(node.path);
            }
          }}
          openByDefault={false}
          overscanCount={8}
          paddingBottom={18}
          rowHeight={30}
          width="100%"
        >
          {(props) => (
            <FileNodeRow
              {...props}
              current={props.node.data.path === activePath}
              loading={loadingPaths.has(props.node.data.path ?? "")}
            />
          )}
        </Tree>
      </div>
    </div>
  );
}

function FileNodeRow({
  node,
  style,
  current,
  loading
}: NodeRendererProps<FileTreeNode> & { current: boolean; loading: boolean }) {
  const isDirectory = node.data.kind === "directory";
  const loadMore = node.data.kind === "loadMore";
  return (
    <div
      aria-current={current ? "page" : undefined}
      className={`tree-row ${node.id === "workspace-root" ? "root-row" : ""} ${
        !isDirectory ? "file-row" : ""
      } ${current ? "current-file" : ""}`}
      onClick={(event) => {
        if (isDirectory) {
          event.stopPropagation();
          node.toggle();
        } else {
          node.handleClick(event);
        }
      }}
      style={style}
      title={node.data.message ?? node.data.path ?? node.data.name}
    >
      <span className="tree-indent" style={{ width: node.level * 15 }} />
      {isDirectory ? (
        loading ? (
          <LoaderCircle className="spin" size={13} />
        ) : node.isOpen ? (
          <ChevronDown size={13} />
        ) : (
          <ChevronRight size={13} />
        )
      ) : loadMore ? (
        <RefreshCw size={12} />
      ) : (
        <span className="tree-spacer" />
      )}
      {isDirectory ? (
        node.isOpen ? (
          <FolderOpen className="folder-icon" size={14} />
        ) : (
          <Folder className="folder-icon" size={14} />
        )
      ) : loadMore ? null : (
        <File size={13} />
      )}
      <span>{node.data.name}</span>
    </div>
  );
}

function ReviewBrowser({
  activeTab,
  onOpen,
  repository,
  revision,
  workspace
}: Pick<
  NavigatorProps,
  "activeTab" | "onOpen" | "repository" | "revision" | "workspace"
>) {
  const [view, setView] = useState<"working" | "history">("working");
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<CommitSummary | null>(null);
  const [historyNextOffset, setHistoryNextOffset] = useState<number | null>(null);
  const [changesNextOffset, setChangesNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHistoryPage, setLoadingHistoryPage] = useState(false);
  const [loadingChangesPage, setLoadingChangesPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const [historyHeight, setHistoryHeight] = useState(() =>
    resizePane(
      Number(window.localStorage.getItem("lcoder.history-height")) || 220,
      0,
      120,
      maxHistoryHeight()
    )
  );
  const tree = useMemo(() => buildChangeTree(changes), [changes]);
  const activePath = selectedReviewPath(
    activeTab,
    view,
    selectedCommit?.oid ?? null
  );
  const historyContext = `${workspace.id}:${revision}:history`;
  const changesContext = `${workspace.id}:${revision}:${view}:${selectedCommit?.oid ?? ""}`;
  const historyContextRef = useRef(historyContext);
  const changesContextRef = useRef(changesContext);
  historyContextRef.current = historyContext;
  changesContextRef.current = changesContext;

  useEffect(() => {
    window.localStorage.setItem("lcoder.history-height", String(historyHeight));
  }, [historyHeight]);

  useEffect(() => {
    setLoadingHistoryPage(false);
    setLoadingChangesPage(false);
  }, [changesContext, historyContext]);

  useEffect(() => {
    const update = () => {
      const height = window.innerHeight;
      setWindowHeight(height);
      setHistoryHeight((current) => resizePane(current, 0, 120, maxHistoryHeight(height)));
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!repository?.isRepository) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setChanges([]);
    setChangesNextOffset(null);
    const request =
      view === "working"
        ? readWorkingChanges(workspace.id).then((page) => {
            if (!cancelled) {
              setChanges(page.changes);
              setChangesNextOffset(page.nextOffset);
            }
          })
        : readHistory(workspace.id).then((page) => {
            if (cancelled) return;
            setCommits(page.commits);
            setHistoryNextOffset(page.nextOffset);
            setSelectedCommit((current) =>
              page.commits.find((commit) => commit.oid === current?.oid) ??
              page.commits[0] ??
              null
            );
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
  }, [repository?.isRepository, revision, view, workspace.id]);

  useEffect(() => {
    if (view !== "history" || !selectedCommit) return;
    let cancelled = false;
    setLoading(true);
    setChanges([]);
    setChangesNextOffset(null);
    void readCommitChanges(workspace.id, selectedCommit.oid)
      .then((page) => {
        if (!cancelled) {
          setChanges(page.changes);
          setChangesNextOffset(page.nextOffset);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, selectedCommit, view, workspace.id]);

  if (!repository?.isRepository) {
    return (
      <div className="navigator">
        <PanelHeader eyebrow="REVIEW" title="No repository" />
        <div className="navigator-empty">
          <FileDiff size={24} />
          <p>This directory is not inside a Git repository.</p>
          <span>Browse and Terminal remain available.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="navigator">
      <PanelHeader eyebrow="REVIEW" title={repository.branch ?? "Detached HEAD"} />
      <div className="segmented review-tabs">
        <button className={view === "working" ? "selected" : ""} onClick={() => setView("working")} type="button">
          Changes <span>{repository.dirtyFiles}</span>
        </button>
        <button className={view === "history" ? "selected" : ""} onClick={() => setView("history")} type="button">
          History
        </button>
      </div>

      {view === "history" ? (
        <>
          <div
            className="commit-list"
            aria-label="Commit history"
            style={{ height: historyHeight }}
          >
            <Tree<CommitSummary>
              aria-label="Commit history"
              childrenAccessor={() => null}
              data={commits}
              disableDrag
              disableDrop
              disableMultiSelection
              height={Math.max(50, historyHeight - (historyNextOffset !== null ? 44 : 0))}
              idAccessor="oid"
              onActivate={(node) => setSelectedCommit(node.data)}
              openByDefault={false}
              overscanCount={6}
              rowHeight={50}
              selection={selectedCommit?.oid}
              width="100%"
            >
              {CommitNodeRow}
            </Tree>
            {historyNextOffset !== null ? (
              <button
                className="load-more-button"
                disabled={loadingHistoryPage}
                onClick={() => {
                  if (loadingHistoryPage) return;
                  const context = historyContextRef.current;
                  setLoadingHistoryPage(true);
                  void readHistory(workspace.id, historyNextOffset)
                    .then((page) => {
                      if (context !== historyContextRef.current) return;
                      setCommits((current) => appendUniqueCommits(current, page.commits));
                      setHistoryNextOffset(page.nextOffset);
                    })
                    .catch((reason: unknown) =>
                      context === historyContextRef.current
                        ? setError(reason instanceof Error ? reason.message : String(reason))
                        : undefined
                    )
                    .finally(() => {
                      if (context === historyContextRef.current) {
                        setLoadingHistoryPage(false);
                      }
                    });
                }}
                type="button"
              >
                {loadingHistoryPage ? "Loading…" : "Load older commits"}
              </button>
            ) : null}
          </div>
          <HorizontalResizeHandle
              onChange={(delta) =>
                setHistoryHeight((current) =>
                  resizePane(current, delta, 120, maxHistoryHeight(windowHeight))
                )
              }
          />
        </>
      ) : null}

      <div className="changes-header">
        <span>{view === "working" ? "WORKING TREE" : selectedCommit?.shortOid ?? "COMMIT"}</span>
        <span>{changes.length} FILES</span>
      </div>
      <div className="tree-scroll review-tree">
        {loading ? <TreeNote depth={0} text="Reading Git…" loading /> : null}
        {error ? <TreeNote depth={0} text={error} /> : null}
        {!loading && !error && tree.length === 0 ? (
          <div className="navigator-empty compact">
            <RefreshCw size={18} />
            <p>No changes in this scope.</p>
          </div>
        ) : null}
        {tree.length ? (
          <Tree<ChangeTreeNode>
            aria-label="Changed files"
            data={tree}
            disableDrag
            disableDrop
            disableMultiSelection
            height={
              view === "history"
                ? Math.max(120, windowHeight - historyHeight - 171)
                : windowHeight - 160
            }
            idAccessor="id"
            indent={15}
            onActivate={(node) => {
              if (node.data.kind === "directory") {
                node.toggle();
                return;
              }
              const change = node.data.change;
              if (!change) return;
              if (view === "working") {
                onOpen({
                  id: `working:${change.path}`,
                  kind: "workingDiff",
                  path: change.path,
                  title: node.data.name,
                  change
                });
              } else if (selectedCommit) {
                onOpen({
                  id: `commit:${selectedCommit.oid}:${change.path}`,
                  kind: "commitDiff",
                  path: change.path,
                  title: node.data.name,
                  change,
                  commit: selectedCommit
                });
              }
            }}
            openByDefault
            overscanCount={8}
            rowHeight={30}
            width="100%"
          >
            {(props) => (
              <ChangeNodeRow
                {...props}
                current={
                  props.node.data.kind === "file" &&
                  props.node.data.path === activePath
                }
              />
            )}
          </Tree>
        ) : null}
        {changesNextOffset !== null ? (
          <button
            className="load-more-button"
            disabled={loadingChangesPage}
            onClick={() => {
              if (loadingChangesPage) return;
              const context = changesContextRef.current;
              setLoadingChangesPage(true);
              const request =
                view === "working"
                  ? readWorkingChanges(workspace.id, changesNextOffset)
                  : selectedCommit
                    ? readCommitChanges(workspace.id, selectedCommit.oid, changesNextOffset)
                    : Promise.resolve({ changes: [], nextOffset: null });
              void request
                .then((page) => {
                  if (context !== changesContextRef.current) return;
                  setChanges((current) => [...current, ...page.changes]);
                  setChangesNextOffset(page.nextOffset);
                })
                .catch((reason: unknown) =>
                  context === changesContextRef.current
                    ? setError(reason instanceof Error ? reason.message : String(reason))
                    : undefined
                )
                .finally(() => {
                  if (context === changesContextRef.current) {
                    setLoadingChangesPage(false);
                  }
                });
            }}
            type="button"
          >
            {loadingChangesPage ? "Loading…" : "Load more files"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CommitNodeRow({ node, style }: NodeRendererProps<CommitSummary>) {
  return (
    <div
      className={`commit-row ${node.isSelected ? "active" : ""}`}
      onClick={(event) => {
        node.handleClick(event);
        node.activate();
      }}
      style={style}
    >
      <GitCommitHorizontal size={14} />
      <span className="commit-copy">
        <strong>{node.data.subject}</strong>
        <small>
          {node.data.shortOid} · {node.data.author} · {formatDate(node.data.authoredAt)}
        </small>
      </span>
    </div>
  );
}

function ChangeNodeRow({
  node,
  style,
  current
}: NodeRendererProps<ChangeTreeNode> & { current: boolean }) {
  const isDirectory = node.data.kind === "directory";
  const change = node.data.change;
  return (
    <div
      aria-current={current ? "page" : undefined}
      className={`tree-row ${isDirectory ? "" : "file-row change-row"} ${
        current ? "current-file" : ""
      }`}
      onClick={(event) => {
        if (isDirectory) {
          event.stopPropagation();
          node.toggle();
        } else {
          node.handleClick(event);
        }
      }}
      style={style}
    >
      <span className="tree-indent" style={{ width: node.level * 15 }} />
      {isDirectory ? (
        node.isOpen ? (
          <ChevronDown size={13} />
        ) : (
          <ChevronRight size={13} />
        )
      ) : (
        <span className="tree-spacer" />
      )}
      {isDirectory ? (
        node.isOpen ? (
          <FolderOpen className="folder-icon" size={14} />
        ) : (
          <Folder className="folder-icon" size={14} />
        )
      ) : (
        <File size={13} />
      )}
      <span>{node.data.name}</span>
      {change ? (
        <span className={`git-status status-${change.status}`}>{statusLabel(change.status)}</span>
      ) : null}
    </div>
  );
}

function HorizontalResizeHandle({
  onChange
}: {
  onChange: (delta: number) => void;
}) {
  const last = useRef(0);
  const start = (clientY: number) => {
    last.current = clientY;
    const move = (event: PointerEvent) => {
      const delta = event.clientY - last.current;
      last.current = event.clientY;
      onChange(delta);
    };
    const stop = () => {
      document.body.classList.remove("resizing-row");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    document.body.classList.add("resizing-row");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  return (
    <div
      aria-label="Resize commit history"
      aria-orientation="horizontal"
      className="history-resize-handle"
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") onChange(-8);
        if (event.key === "ArrowDown") onChange(8);
      }}
      onPointerDown={(event) => start(event.clientY)}
      role="separator"
      tabIndex={0}
    />
  );
}

function appendUniqueCommits(
  current: CommitSummary[],
  incoming: CommitSummary[]
): CommitSummary[] {
  const known = new Set(current.map((commit) => commit.oid));
  return [...current, ...incoming.filter((commit) => !known.has(commit.oid))];
}

function maxHistoryHeight(height = window.innerHeight): number {
  return Math.max(180, height - 340);
}

function PanelHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="panel-header">
      <span>{eyebrow}</span>
      <strong title={title}>{title}</strong>
    </header>
  );
}

function TreeNote({ depth, loading, text }: { depth: number; loading?: boolean; text: string }) {
  return (
    <div className="tree-note" style={{ paddingLeft: 14 + depth * 15 }}>
      {loading ? <LoaderCircle className="spin" size={12} /> : <Clock3 size={12} />}
      <span>{text}</span>
    </div>
  );
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(timestamp * 1000)
  );
}

function statusLabel(status: string): string {
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
