import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

export function fileModelUri(workspaceId: string, tabId: string): monaco.Uri {
  return monaco.Uri.from({
    authority: workspaceAuthority(workspaceId),
    path: `/file/${encodeURIComponent(tabId)}`,
    scheme: "lcoder"
  });
}

export function diffModelUri(
  workspaceId: string,
  tabId: string,
  side: "original" | "modified"
): monaco.Uri {
  return monaco.Uri.from({
    authority: workspaceAuthority(workspaceId),
    path: `/${side}/${encodeURIComponent(tabId)}`,
    scheme: "lcoder-diff"
  });
}

export function ensureFileModel(
  workspaceId: string,
  tabId: string,
  language: string,
  content: string
): monaco.editor.ITextModel {
  const uri = fileModelUri(workspaceId, tabId);
  const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, language, uri);
  if (model.getValue() !== content) model.setValue(content);
  return model;
}

export function ensureDiffModels(
  workspaceId: string,
  tabId: string,
  language: string,
  original: string,
  modified: string
): { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } {
  const originalUri = diffModelUri(workspaceId, tabId, "original");
  const modifiedUri = diffModelUri(workspaceId, tabId, "modified");
  const originalModel =
    monaco.editor.getModel(originalUri) ?? monaco.editor.createModel(original, language, originalUri);
  const modifiedModel =
    monaco.editor.getModel(modifiedUri) ?? monaco.editor.createModel(modified, language, modifiedUri);
  if (originalModel.getValue() !== original) originalModel.setValue(original);
  if (modifiedModel.getValue() !== modified) modifiedModel.setValue(modified);
  return { original: originalModel, modified: modifiedModel };
}

export function disposeClosedModels(workspaceId: string, liveTabIds: string[]): void {
  const authority = workspaceAuthority(workspaceId);
  const live = new Set(liveTabIds.map(encodeURIComponent));
  for (const model of monaco.editor.getModels()) {
    if (
      (model.uri.scheme === "lcoder" || model.uri.scheme === "lcoder-diff") &&
      model.uri.authority === authority
    ) {
      const id = model.uri.path.split("/").at(-1);
      if (!id || !live.has(id)) model.dispose();
    }
  }
}

function workspaceAuthority(workspaceId: string): string {
  return `workspace-${workspaceId.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`;
}
