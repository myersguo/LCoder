import type { DocumentTab } from "./types";

export function shouldRefreshTabContent(
  tab: DocumentTab | null,
  changedPaths: string[] | null
): boolean {
  if (!tab) return false;
  if (changedPaths === null) return true;
  return changedPaths.some((changedPath) => tabTouchesPath(tab, changedPath));
}

function tabTouchesPath(tab: DocumentTab, changedPath: string): boolean {
  if (tab.kind === "commitDiff" || tab.kind === "branchDiff") return false;
  return tabPaths(tab).some((tabPath) => tabPath === changedPath);
}

function tabPaths(tab: DocumentTab): string[] {
  if (tab.kind === "file") return [tab.path];
  return [tab.path, tab.change.originalPath].filter((path): path is string => Boolean(path));
}
