import type { DocumentTab } from "./types";

export function selectedBrowsePath(tab: DocumentTab | null): string | null {
  return tab?.kind === "file" ? tab.path : null;
}

export function selectedReviewPath(
  tab: DocumentTab | null,
  view: "working" | "history" | "branches",
  selectedId: string | null
): string | null {
  if (view === "working") {
    return tab?.kind === "workingDiff" ? tab.path : null;
  }
  if (view === "history") {
    return tab?.kind === "commitDiff" && tab.commit.oid === selectedId ? tab.path : null;
  }
  return tab?.kind === "branchDiff" && branchComparisonId(tab.comparison) === selectedId
    ? tab.path
    : null;
}

export function branchComparisonId(comparison: {
  base: string;
  head: string;
  baseOid: string;
  mergeBaseOid: string;
  headOid: string;
}): string {
  return `${comparison.base}...${comparison.head}:${comparison.baseOid}:${comparison.mergeBaseOid}:${comparison.headOid}`;
}
