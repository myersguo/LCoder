import type { DocumentTab } from "./types";

export function selectedBrowsePath(tab: DocumentTab | null): string | null {
  return tab?.kind === "file" ? tab.path : null;
}

export function selectedReviewPath(
  tab: DocumentTab | null,
  view: "working" | "history",
  commitOid: string | null
): string | null {
  if (view === "working") {
    return tab?.kind === "workingDiff" ? tab.path : null;
  }
  return tab?.kind === "commitDiff" && tab.commit.oid === commitOid ? tab.path : null;
}
