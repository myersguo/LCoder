export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  watching: boolean;
  warning: string | null;
}

export type EntryKind = "directory" | "file" | "symlink" | "unsupported";

export interface DirectoryEntry {
  kind: EntryKind;
  name: string;
  path: string | null;
  message: string | null;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  nextOffset: number | null;
  warningCount: number;
}

export interface FileSearchMatch {
  name: string;
  path: string;
}

export interface FileSearchPage {
  matches: FileSearchMatch[];
  truncated: boolean;
}

export type FileView =
  | { kind: "text"; path: string; content: string; version: string }
  | { kind: "unsupported"; path: string; reason: string; size: number };

export interface WatchState {
  changed: boolean;
  revision: number;
}

export interface RepositorySummary {
  isRepository: boolean;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  dirtyFiles: number;
  workspacePrefix: string | null;
  error: string | null;
}

export type ChangeStatus =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "typeChanged"
  | "unmerged"
  | "untracked";

export interface GitChange {
  path: string;
  originalPath: string | null;
  staged: ChangeStatus | null;
  unstaged: ChangeStatus | null;
  status: ChangeStatus;
}

export interface ChangePage {
  changes: GitChange[];
  nextOffset: number | null;
}

export interface BranchSummary {
  name: string;
  current: boolean;
}

export interface BranchComparison {
  base: string;
  head: string;
  baseOid: string;
  headOid: string;
  mergeBaseOid: string;
}

export interface BranchChangePage {
  changes: GitChange[];
  nextOffset: number | null;
  comparison: BranchComparison;
}

export interface CommitSummary {
  oid: string;
  shortOid: string;
  parentOids: string[];
  author: string;
  authoredAt: number;
  subject: string;
  message: string;
}

export interface CommitPage {
  commits: CommitSummary[];
  nextOffset: number | null;
}

export type FileComparison =
  | {
      kind: "text";
      path: string;
      originalPath: string | null;
      baseline: string;
      status: ChangeStatus;
      original: string;
      modified: string;
    }
  | {
      kind: "unsupported";
      path: string;
      originalPath: string | null;
      baseline: string;
      status: ChangeStatus;
      reason: string;
    };

export interface TerminalProfile {
  id: string;
  label: string;
  available: boolean;
  executable: string | null;
  version: string | null;
}

export interface TerminalInfo {
  id: string;
  profileId: string;
  title: string;
}

export type TerminalEvent =
  | { type: "output"; sessionId: string; data: number[] }
  | { type: "exit"; sessionId: string; code: number; signal: string | null }
  | { type: "error"; sessionId: string; message: string };

export interface CodeSelection {
  path: string;
  language: string;
  side: "file" | "original" | "modified";
  scope: "selection" | "file";
  sourceRef:
    | { kind: "workingTree" }
    | { kind: "head" }
    | { kind: "commit"; oid: string }
    | { kind: "branch"; branch: string; oid: string }
    | { kind: "emptyTree" };
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
}

export type AiCodeAction = "explain" | "review";

export interface AiCodeRequest {
  id: number;
  action: AiCodeAction;
  selection: CodeSelection;
}

export type DocumentTab =
  | { id: string; kind: "file"; path: string; title: string }
  | {
      id: string;
      kind: "workingDiff";
      path: string;
      title: string;
      change: GitChange;
    }
  | {
      id: string;
      kind: "commitDiff";
      path: string;
      title: string;
      change: GitChange;
      commit: CommitSummary;
    }
  | {
      id: string;
      kind: "branchDiff";
      path: string;
      title: string;
      change: GitChange;
      comparison: BranchComparison;
    };
