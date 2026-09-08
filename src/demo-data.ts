import type {
  ChangePage,
  CommitPage,
  DirectoryPage,
  FileComparison,
  FileView,
  RepositorySummary,
  TerminalProfile,
  WorkspaceSummary
} from "./types";

export const demoWorkspace: WorkspaceSummary = {
  id: "demo-workspace",
  name: "atlas-parser",
  path: "/home/demo/projects/atlas-parser",
  trusted: false,
  watching: true,
  warning: null
};

const directories: Record<string, DirectoryPage> = {
  "": {
    entries: [
      { kind: "directory", name: "src", path: "src", message: null },
      { kind: "directory", name: "tests", path: "tests", message: null },
      { kind: "file", name: "Cargo.toml", path: "Cargo.toml", message: null },
      { kind: "file", name: "README.md", path: "README.md", message: null }
    ],
    nextOffset: null,
    warningCount: 0
  },
  src: {
    entries: [
      { kind: "directory", name: "parser", path: "src/parser", message: null },
      { kind: "file", name: "lib.rs", path: "src/lib.rs", message: null },
      { kind: "file", name: "main.rs", path: "src/main.rs", message: null }
    ],
    nextOffset: null,
    warningCount: 0
  },
  "src/parser": {
    entries: [
      { kind: "file", name: "lexer.rs", path: "src/parser/lexer.rs", message: null },
      { kind: "file", name: "syntax.rs", path: "src/parser/syntax.rs", message: null }
    ],
    nextOffset: null,
    warningCount: 0
  },
  tests: {
    entries: [{ kind: "file", name: "parser_test.rs", path: "tests/parser_test.rs", message: null }],
    nextOffset: null,
    warningCount: 0
  }
};

const files: Record<string, string> = {
  "src/lib.rs": `pub mod parser;\n\npub fn parse(source: &str) -> Result<Ast, ParseError> {\n    parser::parse(source)\n}\n`,
  "src/main.rs": `use atlas_parser::parse;\n\nfn main() {\n    let source = std::fs::read_to_string("input.atlas").unwrap();\n    println!("{:#?}", parse(&source));\n}\n`,
  "src/parser/lexer.rs": `pub fn tokenize(source: &str) -> Vec<Token> {\n    source\n        .split_whitespace()\n        .map(Token::from)\n        .collect()\n}\n`,
  "src/parser/syntax.rs": `pub fn parse(source: &str) -> Result<Ast, ParseError> {\n    let tokens = tokenize(source);\n    Parser::new(tokens).parse_document()\n}\n`,
  "tests/parser_test.rs": `#[test]\nfn parses_empty_document() {\n    assert!(parse("").is_ok());\n}\n`,
  "Cargo.toml": `[package]\nname = "atlas-parser"\nversion = "0.4.0"\nedition = "2024"\n`,
  "README.md": `# Atlas Parser\n\nA small, deterministic parser for Atlas documents.\n`
};

export const demoRepository: RepositorySummary = {
  isRepository: true,
  branch: "feature/token-spans",
  detached: false,
  unborn: false,
  dirtyFiles: 3,
  workspacePrefix: null,
  error: null
};

export const demoChanges: ChangePage = {
  changes: [
    {
      path: "src/parser/lexer.rs",
      originalPath: null,
      staged: null,
      unstaged: "modified",
      status: "modified"
    },
    {
      path: "src/parser/span.rs",
      originalPath: null,
      staged: "added",
      unstaged: null,
      status: "added"
    },
    {
      path: "tests/parser_test.rs",
      originalPath: null,
      staged: null,
      unstaged: "modified",
      status: "modified"
    }
  ],
  nextOffset: null
};

export const demoCommits: CommitPage = {
  commits: [
    {
      oid: "84a1fc87641dd43bd78d604327ace54193fdac41",
      shortOid: "84a1fc8",
      parentOids: ["729f212913a632bbb6771240aa1c50ef65a9f877"],
      author: "Mina Lee",
      authoredAt: 1788734400,
      subject: "feat(parser): preserve token source spans",
      message: "feat(parser): preserve token source spans"
    },
    {
      oid: "729f212913a632bbb6771240aa1c50ef65a9f877",
      shortOid: "729f212",
      parentOids: ["bc6a91e1c4fd887125eca1998867159f78003e92"],
      author: "Alex Chen",
      authoredAt: 1788648000,
      subject: "test: cover malformed headers",
      message: "test: cover malformed headers"
    },
    {
      oid: "bc6a91e1c4fd887125eca1998867159f78003e92",
      shortOid: "bc6a91e",
      parentOids: [],
      author: "Mina Lee",
      authoredAt: 1788561600,
      subject: "chore: initialize parser crate",
      message: "chore: initialize parser crate"
    }
  ],
  nextOffset: null
};

export const demoProfiles: TerminalProfile[] = [
  { id: "shell", label: "Shell", available: true, executable: "/bin/zsh", version: "zsh" },
  {
    id: "codex",
    label: "Codex",
    available: true,
    executable: "/opt/homebrew/bin/codex",
    version: "codex-cli 0.148.0"
  },
  {
    id: "claude",
    label: "Claude Code",
    available: true,
    executable: "/opt/homebrew/bin/claude",
    version: "2.1.226"
  },
  {
    id: "traex",
    label: "TraeX",
    available: true,
    executable: "/home/demo/.local/bin/traex",
    version: "traecli 0.202.3"
  }
];

export function demoDirectory(path: string): DirectoryPage {
  return directories[path] ?? { entries: [], nextOffset: null, warningCount: 0 };
}

export function demoFile(path: string): FileView {
  return {
    kind: "text",
    path,
    content: files[path] ?? `// ${path}\n// Preview content is unavailable in browser mode.\n`,
    version: "demo"
  };
}

export function demoWorkingComparison(path: string): FileComparison {
  const change = demoChanges.changes.find((item) => item.path === path) ?? demoChanges.changes[0];
  return {
    kind: "text",
    path: change.path,
    originalPath: change.originalPath,
    baseline: "HEAD → working tree",
    status: change.status,
    original: `pub fn tokenize(source: &str) -> Vec<Token> {\n    source.split_whitespace().map(Token::from).collect()\n}\n`,
    modified: `pub fn tokenize(source: &str) -> Vec<Token> {\n    source\n        .split_whitespace()\n        .enumerate()\n        .map(|(offset, value)| Token::with_span(value, offset))\n        .collect()\n}\n`
  };
}

export function demoCommitComparison(path: string): FileComparison {
  return { ...demoWorkingComparison(path), baseline: "parent → commit" };
}
