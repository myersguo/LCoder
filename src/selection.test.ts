import { describe, expect, it } from "vitest";

import { codeSourceContext } from "./selection";
import type { DocumentTab } from "./types";

describe("codeSourceContext", () => {
  it("uses the working tree and HEAD for working diffs", () => {
    const tab: DocumentTab = {
      id: "working:src/new.ts",
      kind: "workingDiff",
      path: "src/new.ts",
      title: "new.ts",
      change: {
        path: "src/new.ts",
        originalPath: "src/old.ts",
        staged: "renamed",
        unstaged: null,
        status: "renamed"
      }
    };

    expect(codeSourceContext(tab, "modified")).toEqual({
      path: "src/new.ts",
      sourceRef: { kind: "workingTree" }
    });
    expect(codeSourceContext(tab, "original")).toEqual({
      path: "src/old.ts",
      sourceRef: { kind: "head" }
    });
  });

  it("keeps commit versions explicit for history diffs", () => {
    const tab: DocumentTab = {
      id: "commit:abc:src/file.ts",
      kind: "commitDiff",
      path: "src/file.ts",
      title: "file.ts",
      change: {
        path: "src/file.ts",
        originalPath: null,
        staged: null,
        unstaged: null,
        status: "modified"
      },
      commit: {
        oid: "abc123",
        shortOid: "abc123",
        parentOids: ["def456"],
        author: "Test",
        authoredAt: 0,
        subject: "change",
        message: "change"
      }
    };

    expect(codeSourceContext(tab, "modified").sourceRef).toEqual({
      kind: "commit",
      oid: "abc123"
    });
    expect(codeSourceContext(tab, "original").sourceRef).toEqual({
      kind: "commit",
      oid: "def456"
    });
  });

  it("keeps branch comparison sides pinned to their resolved commits", () => {
    const tab: DocumentTab = {
      id: "branch:main...feature:src/file.ts",
      kind: "branchDiff",
      path: "src/file.ts",
      title: "file.ts",
      change: {
        path: "src/file.ts",
        originalPath: "src/old.ts",
        staged: null,
        unstaged: null,
        status: "renamed"
      },
      comparison: {
        base: "main",
        head: "feature",
        baseOid: "base",
        headOid: "head",
        mergeBaseOid: "merge-base"
      }
    };

    expect(codeSourceContext(tab, "modified")).toEqual({
      path: "src/file.ts",
      sourceRef: { kind: "branch", branch: "feature", oid: "head" }
    });
    expect(codeSourceContext(tab, "original")).toEqual({
      path: "src/old.ts",
      sourceRef: { kind: "branch", branch: "main", oid: "merge-base" }
    });
  });
});
