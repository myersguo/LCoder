import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import {
  demoChanges,
  demoCommitComparison,
  demoCommits,
  demoDirectory,
  demoFile,
  demoProfiles,
  demoRepository,
  demoSearchFiles,
  demoWorkingComparison,
  demoWorkspace
} from "./demo-data";
import type {
  BranchChangePage,
  BranchComparison,
  BranchSummary,
  ChangePage,
  CommitPage,
  CommitSummary,
  DirectoryPage,
  FileSearchPage,
  FileComparison,
  FileView,
  GitChange,
  RepositorySummary,
  TerminalEvent,
  TerminalInfo,
  TerminalProfile,
  WatchState,
  WorkspaceSummary
} from "./types";

const desktop = isTauri();
const browserDemo = import.meta.env.VITE_LCODER_DEMO === "1";

export function isDesktop(): boolean {
  return desktop;
}

export async function chooseWorkspace(): Promise<WorkspaceSummary | null> {
  if (browserDemo) return demoWorkspace;
  if (!desktop) throw new Error("Opening local directories requires the LCoder desktop app.");
  return invoke("workspace_choose");
}

export async function restoreWorkspace(): Promise<WorkspaceSummary | null> {
  if (browserDemo) return demoWorkspace;
  if (!desktop) return null;
  return invoke("workspace_recent");
}

export async function setWorkspaceTrusted(
  workspaceId: string,
  trusted: boolean
): Promise<WorkspaceSummary> {
  if (browserDemo) return { ...demoWorkspace, trusted };
  if (!desktop) throw new Error("Workspace trust requires the LCoder desktop app.");
  return invoke("workspace_set_trusted", { workspaceId, trusted });
}

export async function listDirectory(
  workspaceId: string,
  path: string,
  offset = 0,
  limit = 500
): Promise<DirectoryPage> {
  if (browserDemo) return demoDirectory(path);
  if (!desktop) throw new Error("Directory browsing requires the LCoder desktop app.");
  return invoke("workspace_directory", { workspaceId, path, offset, limit });
}

export async function readFile(workspaceId: string, path: string): Promise<FileView> {
  if (browserDemo) return demoFile(path);
  if (!desktop) throw new Error("File reading requires the LCoder desktop app.");
  return invoke("workspace_file", { request: { workspaceId, path } });
}

export async function searchFiles(
  workspaceId: string,
  query: string
): Promise<FileSearchPage> {
  if (browserDemo) return demoSearchFiles(query);
  if (!desktop) throw new Error("File filtering requires the LCoder desktop app.");
  return invoke("workspace_search_files", { workspaceId, query });
}

export async function watchWorkspace(
  workspaceId: string,
  afterRevision: number
): Promise<WatchState> {
  if (browserDemo) return { changed: false, revision: afterRevision || 1 };
  if (!desktop) return { changed: false, revision: afterRevision };
  return invoke("workspace_watch", { workspaceId, afterRevision });
}

export async function readRepository(workspaceId: string): Promise<RepositorySummary> {
  if (browserDemo) return demoRepository;
  if (!desktop) throw new Error("Git review requires the LCoder desktop app.");
  return invoke("git_repository", { workspaceId });
}

export async function readWorkingChanges(
  workspaceId: string,
  offset = 0,
  limit = 500
): Promise<ChangePage> {
  if (browserDemo) return demoChanges;
  if (!desktop) throw new Error("Git review requires the LCoder desktop app.");
  return invoke("git_working_changes", { request: { workspaceId, offset, limit } });
}

export async function readWorkingFile(
  workspaceId: string,
  change: GitChange
): Promise<FileComparison> {
  if (browserDemo) return demoWorkingComparison(change.path);
  if (!desktop) throw new Error("Git review requires the LCoder desktop app.");
  return invoke("git_working_file", {
    request: {
      workspaceId,
      path: change.path
    }
  });
}

export async function readBranches(workspaceId: string): Promise<BranchSummary[]> {
  if (browserDemo) {
    return [
      { name: "feature/token-spans", current: true },
      { name: "main", current: false }
    ];
  }
  if (!desktop) throw new Error("Branch comparison requires the LCoder desktop app.");
  return invoke("git_branches", { workspaceId });
}

export async function readBranchChanges(
  workspaceId: string,
  base: string,
  head: string,
  offset = 0,
  limit = 500
): Promise<BranchChangePage> {
  if (browserDemo) {
    return {
      ...demoChanges,
      comparison: {
        base,
        head,
        baseOid: "729f212913a632bbb6771240aa1c50ef65a9f877",
        headOid: "84a1fc87641dd43bd78d604327ace54193fdac41",
        mergeBaseOid: "729f212913a632bbb6771240aa1c50ef65a9f877"
      }
    };
  }
  if (!desktop) throw new Error("Branch comparison requires the LCoder desktop app.");
  return invoke("git_branch_changes", {
    request: { workspaceId, base, head, offset, limit }
  });
}

export async function readBranchFile(
  workspaceId: string,
  comparison: BranchComparison,
  change: GitChange
): Promise<FileComparison> {
  if (browserDemo) {
    return {
      ...demoWorkingComparison(change.path),
      baseline: `${comparison.base}...${comparison.head}`
    };
  }
  if (!desktop) {
    throw new Error("Branch comparison requires the LCoder desktop app.");
  }
  return invoke("git_branch_file", {
    request: {
      workspaceId,
      comparison,
      path: change.path
    }
  });
}

export async function readHistory(
  workspaceId: string,
  offset = 0,
  limit = 50
): Promise<CommitPage> {
  if (browserDemo) return demoCommits;
  if (!desktop) throw new Error("Git history requires the LCoder desktop app.");
  return invoke("git_history", { request: { workspaceId, offset, limit } });
}

export async function readCommitChanges(
  workspaceId: string,
  oid: string,
  offset = 0,
  limit = 500
): Promise<ChangePage> {
  if (browserDemo) return demoChanges;
  if (!desktop) throw new Error("Git history requires the LCoder desktop app.");
  return invoke("git_commit_changes", { request: { workspaceId, oid, offset, limit } });
}

export async function readCommitFile(
  workspaceId: string,
  commit: CommitSummary,
  change: GitChange
): Promise<FileComparison> {
  if (browserDemo) return demoCommitComparison(change.path);
  if (!desktop) throw new Error("Git history requires the LCoder desktop app.");
  return invoke("git_commit_file", {
    request: {
      workspaceId,
      oid: commit.oid,
      path: change.path
    }
  });
}

export async function readTerminalProfiles(): Promise<TerminalProfile[]> {
  if (browserDemo) return demoProfiles;
  if (!desktop) return [];
  return invoke("terminal_profiles");
}

export async function chooseTerminalExecutable(profileId: string): Promise<TerminalProfile[] | null> {
  if (browserDemo) return demoProfiles;
  if (!desktop) throw new Error("Terminal settings require the LCoder desktop app.");
  return invoke("terminal_profile_choose", { profileId });
}

export async function startTerminal(
  workspaceId: string,
  profileId: string,
  rows: number,
  cols: number,
  onEvent: (event: TerminalEvent) => void
): Promise<TerminalInfo> {
  if (browserDemo) {
    window.setTimeout(() => {
      onEvent({
        type: "output",
        sessionId: "demo-terminal",
        data: Array.from(
          new TextEncoder().encode(
            `\u001b[38;5;214mLCoder browser preview\u001b[0m\r\n` +
              `Native ${profileId} PTY is available in the desktop build.\r\n`
          )
        )
      });
    }, 80);
    return { id: "demo-terminal", profileId, title: profileId };
  }
  if (!desktop) throw new Error("Terminal requires the LCoder desktop app.");
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke("terminal_start", { workspaceId, profileId, rows, cols, onEvent: channel });
}

export async function writeTerminal(sessionId: string, data: Uint8Array): Promise<void> {
  if (!desktop) return;
  await invoke("terminal_write", { sessionId, data: Array.from(data) });
}

export async function resizeTerminal(
  sessionId: string,
  rows: number,
  cols: number
): Promise<void> {
  if (!desktop) return;
  await invoke("terminal_resize", { sessionId, rows, cols });
}

export async function acknowledgeTerminal(sessionId: string, bytes: number): Promise<void> {
  if (!desktop) return;
  await invoke("terminal_ack", { sessionId, bytes });
}

export async function stopTerminal(sessionId: string): Promise<void> {
  if (!desktop) return;
  await invoke("terminal_stop", { sessionId });
}
