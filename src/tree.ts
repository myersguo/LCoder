import type { GitChange } from "./types";

export interface ChangeTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  children?: ChangeTreeNode[];
  change?: GitChange;
}

export function buildChangeTree(changes: GitChange[]): ChangeTreeNode[] {
  const root: ChangeTreeNode = {
    id: "root",
    name: "root",
    path: "",
    kind: "directory",
    children: []
  };
  for (const change of changes) {
    const parts = change.path.split("/");
    let parent = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let node = parent.children?.find((candidate) => candidate.name === part);
      if (!node) {
        node = {
          id: `${isFile ? "file" : "directory"}:${path}`,
          name: part,
          path,
          kind: isFile ? "file" : "directory",
          children: isFile ? undefined : []
        };
        parent.children?.push(node);
      }
      if (isFile) node.change = change;
      parent = node;
    });
  }
  sortTree(root.children ?? []);
  return root.children ?? [];
}

export function filterChanges(changes: GitChange[], query: string): GitChange[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return changes;
  return changes.filter(
    (change) =>
      change.path.toLowerCase().includes(normalized) ||
      change.originalPath?.toLowerCase().includes(normalized)
  );
}

function sortTree(nodes: ChangeTreeNode[]): void {
  nodes.sort(
    (left, right) =>
      Number(left.kind === "file") - Number(right.kind === "file") ||
      left.name.localeCompare(right.name)
  );
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}
