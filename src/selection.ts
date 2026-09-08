import type { editor } from "monaco-editor";

import { clampSelectionText } from "./explain-selection";
import type { CodeSelection, DocumentTab } from "./types";

export function readCodeSelection(
  editorInstance: editor.ICodeEditor,
  tab: DocumentTab,
  language: string,
  side: CodeSelection["side"]
): CodeSelection | null {
  const range = editorInstance.getSelection();
  const model = editorInstance.getModel();
  if (!range || range.isEmpty() || !model) return null;

  const selected = clampSelectionText(model.getValueInRange(range));
  const context = codeSourceContext(tab, side);
  return {
    path: context.path,
    language,
    side,
    scope: "selection",
    sourceRef: context.sourceRef,
    startLine: range.startLineNumber,
    endLine: range.endLineNumber,
    text: selected.text,
    truncated: selected.truncated
  };
}

export function entireFileRequest(
  editorInstance: editor.ICodeEditor,
  tab: DocumentTab,
  language: string,
  side: CodeSelection["side"]
): CodeSelection {
  const context = codeSourceContext(tab, side);
  return {
    path: context.path,
    language,
    side,
    scope: "file",
    sourceRef: context.sourceRef,
    startLine: 1,
    endLine: editorInstance.getModel()?.getLineCount() ?? 1,
    text: "",
    truncated: false
  };
}

export function codeSourceContext(
  tab: DocumentTab,
  side: CodeSelection["side"]
): { path: string; sourceRef: CodeSelection["sourceRef"] } {
  if (tab.kind === "file") {
    return {
      path: tab.path,
      sourceRef: { kind: "workingTree" }
    };
  }

  const originalPath = tab.change.originalPath ?? tab.path;
  if (tab.kind === "workingDiff") {
    return side === "original"
      ? { path: originalPath, sourceRef: { kind: "head" } }
      : { path: tab.path, sourceRef: { kind: "workingTree" } };
  }

  const firstParent = tab.commit.parentOids[0];
  return side === "original"
    ? {
        path: originalPath,
        sourceRef: firstParent
          ? { kind: "commit", oid: firstParent }
          : { kind: "emptyTree" }
      }
    : {
        path: tab.path,
        sourceRef: { kind: "commit", oid: tab.commit.oid }
      };
}
