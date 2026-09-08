import { describe, expect, it } from "vitest";

import { buildChangeTree, filterChanges } from "./tree";

const changes = [
  {
    path: "README.md",
    originalPath: null,
    staged: null,
    unstaged: "modified" as const,
    status: "modified" as const
  },
  {
    path: "src/z.ts",
    originalPath: null,
    staged: "added" as const,
    unstaged: null,
    status: "added" as const
  },
  {
    path: "src/a.ts",
    originalPath: "legacy/A.ts",
    staged: null,
    unstaged: "renamed" as const,
    status: "renamed" as const
  }
];

describe("buildChangeTree", () => {
  it("projects changed paths into sorted virtual directories", () => {
    const tree = buildChangeTree(changes);

    expect(tree.map((node) => node.name)).toEqual(["src", "README.md"]);
    expect(tree[0].children?.map((node) => node.name)).toEqual(["a.ts", "z.ts"]);
  });
});

describe("filterChanges", () => {
  it("matches current and original paths case-insensitively", () => {
    expect(filterChanges(changes, "read").map((change) => change.path)).toEqual(["README.md"]);
    expect(filterChanges(changes, "LEGACY").map((change) => change.path)).toEqual(["src/a.ts"]);
  });

  it("returns all changes when the query is blank", () => {
    expect(filterChanges(changes, "   ")).toBe(changes);
  });
});
