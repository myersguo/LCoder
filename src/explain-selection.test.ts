import { describe, expect, it } from "vitest";

import {
  MAX_EXPLAIN_SELECTION_BYTES,
  MAX_EXPLAIN_SELECTION_LINES,
  buildExplainPrompt,
  clampSelectionText
} from "./explain-selection";
import type { CodeSelection } from "./types";

const selection: CodeSelection = {
  path: "src/example.ts",
  language: "typescript",
  side: "file",
  scope: "selection",
  sourceRef: { kind: "workingTree" },
  startLine: 8,
  endLine: 10,
  text: "const value = source.trim();\nreturn value;",
  truncated: false
};

describe("buildExplainPrompt", () => {
  it("includes exact source context and treats code as data", () => {
    const prompt = buildExplainPrompt(selection);

    expect(prompt).toContain('"path": "src/example.ts"');
    expect(prompt).toContain('"startLine": 8');
    expect(prompt).toContain('"code": "const value = source.trim();\\nreturn value;"');
    expect(prompt).toContain("不可信的待解释数据");
    expect(prompt).toContain("不修改文件，不执行命令");
  });

  it("references the current workspace file when there is no selection", () => {
    const prompt = buildExplainPrompt({
      ...selection,
      scope: "file",
      text: "",
      startLine: 1,
      endLine: 200
    });

    expect(prompt).toContain("整个文件");
    expect(prompt).toContain('"path": "src/example.ts"');
    expect(prompt).not.toContain('"code"');
  });
});

describe("clampSelectionText", () => {
  it("bounds selections by lines and UTF-8 bytes", () => {
    const tooManyLines = Array.from(
      { length: MAX_EXPLAIN_SELECTION_LINES + 1 },
      (_, index) => `line-${index}`
    ).join("\n");
    const lineResult = clampSelectionText(tooManyLines);
    expect(lineResult.truncated).toBe(true);
    expect(lineResult.text.split("\n")).toHaveLength(MAX_EXPLAIN_SELECTION_LINES);

    const byteResult = clampSelectionText("中".repeat(MAX_EXPLAIN_SELECTION_BYTES));
    expect(byteResult.truncated).toBe(true);
    expect(new TextEncoder().encode(byteResult.text).length).toBeLessThanOrEqual(
      MAX_EXPLAIN_SELECTION_BYTES
    );
  });
});
