import { describe, expect, it } from "vitest";

import { shouldRefreshTabContent } from "./refresh-scope";
import type { DocumentTab } from "./types";

const workingTab: DocumentTab = {
  id: "working:src/file.ts",
  kind: "workingDiff",
  path: "src/file.ts",
  title: "file.ts",
  change: {
    path: "src/file.ts",
    originalPath: "src/old-file.ts",
    staged: null,
    unstaged: "renamed",
    status: "renamed"
  }
};

describe("shouldRefreshTabContent", () => {
  it("does not refresh a review tab for unrelated file changes", () => {
    expect(shouldRefreshTabContent(workingTab, ["src/other.ts"])).toBe(false);
  });

  it("refreshes a review tab when its current or original path changes", () => {
    expect(shouldRefreshTabContent(workingTab, ["src/file.ts"])).toBe(true);
    expect(shouldRefreshTabContent(workingTab, ["src/old-file.ts"])).toBe(true);
  });

  it("refreshes conservatively when changed paths are unknown", () => {
    expect(shouldRefreshTabContent(workingTab, null)).toBe(true);
  });

  it("does not refresh immutable commit or branch diffs for working-tree file changes", () => {
    expect(
      shouldRefreshTabContent(
        {
          ...workingTab,
          id: "commit:abc:src/file.ts",
          kind: "commitDiff",
          commit: {
            oid: "abc",
            shortOid: "abc",
            parentOids: ["def"],
            author: "Test",
            authoredAt: 0,
            subject: "change",
            message: "change"
          }
        },
        ["src/file.ts"]
      )
    ).toBe(false);
    expect(
      shouldRefreshTabContent(
        {
          ...workingTab,
          id: "branch:main...feature:src/file.ts",
          kind: "branchDiff",
          comparison: {
            base: "main",
            head: "feature",
            baseOid: "base",
            headOid: "head",
            mergeBaseOid: "merge-base"
          }
        },
        ["src/file.ts"]
      )
    ).toBe(false);
  });
});
