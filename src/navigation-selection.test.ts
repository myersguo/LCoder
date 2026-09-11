import { describe, expect, it } from "vitest";

import {
  branchComparisonId,
  selectedBrowsePath,
  selectedReviewPath
} from "./navigation-selection";
import type { DocumentTab } from "./types";

const workingTab: DocumentTab = {
  id: "working:src/main.ts",
  kind: "workingDiff",
  path: "src/main.ts",
  title: "main.ts",
  change: {
    path: "src/main.ts",
    originalPath: null,
    staged: null,
    unstaged: "modified",
    status: "modified"
  }
};

const commitTab: DocumentTab = {
  ...workingTab,
  id: "commit:abc:src/main.ts",
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
};

const branchComparison = {
  base: "main",
  head: "feature",
  baseOid: "base",
  headOid: "head",
  mergeBaseOid: "merge-base"
};

const branchTab: DocumentTab = {
  ...workingTab,
  id: "branch:main...feature:src/main.ts",
  kind: "branchDiff",
  comparison: branchComparison
};

describe("navigator active file projection", () => {
  it("highlights only ordinary files in Browse", () => {
    expect(
      selectedBrowsePath({
        id: "file:src/main.ts",
        kind: "file",
        path: "src/main.ts",
        title: "main.ts"
      })
    ).toBe("src/main.ts");
    expect(selectedBrowsePath(workingTab)).toBeNull();
  });

  it("keeps Working and selected History commit identities separate", () => {
    expect(selectedReviewPath(workingTab, "working", null)).toBe("src/main.ts");
    expect(selectedReviewPath(commitTab, "history", "abc")).toBe("src/main.ts");
    expect(selectedReviewPath(commitTab, "history", "other")).toBeNull();
    expect(selectedReviewPath(workingTab, "history", "abc")).toBeNull();
    expect(selectedReviewPath(branchTab, "branches", branchComparisonId(branchComparison))).toBe(
      "src/main.ts"
    );
    expect(selectedReviewPath(branchTab, "branches", "main...other")).toBeNull();
  });
});
