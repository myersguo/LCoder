import { describe, expect, it } from "vitest";

import { buildChangeTree } from "./tree";

describe("buildChangeTree", () => {
  it("projects changed paths into sorted virtual directories", () => {
    const tree = buildChangeTree([
      {
        path: "README.md",
        originalPath: null,
        staged: null,
        unstaged: "modified",
        status: "modified"
      },
      {
        path: "src/z.ts",
        originalPath: null,
        staged: "added",
        unstaged: null,
        status: "added"
      },
      {
        path: "src/a.ts",
        originalPath: null,
        staged: null,
        unstaged: "modified",
        status: "modified"
      }
    ]);

    expect(tree.map((node) => node.name)).toEqual(["src", "README.md"]);
    expect(tree[0].children?.map((node) => node.name)).toEqual(["a.ts", "z.ts"]);
  });
});
