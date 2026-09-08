import { describe, expect, it } from "vitest";

import { resizePane } from "./layout";

describe("resizePane", () => {
  it("accumulates consecutive drag deltas from the latest width", () => {
    const first = resizePane(240, 20, 200, 420);
    const second = resizePane(first, 20, 200, 420);

    expect(second).toBe(280);
  });

  it("supports inverse terminal resizing and clamps limits", () => {
    expect(resizePane(430, 50, 300, 620, -1)).toBe(380);
    expect(resizePane(610, -50, 300, 620, -1)).toBe(620);
  });
});
