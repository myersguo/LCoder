# Architecture

LCoder is a local-first, read-only code and Git review workbench.

## Runtime boundary

```text
React UI
  └─ typed Tauri commands and Channels
       └─ Rust
            ├─ workspace registry and bounded file reads
            ├─ scoped, read-only Git commands
            └─ fixed-profile PTY controller
```

The renderer receives an opaque workspace ID and uses relative paths. Rust owns canonical absolute
paths, executable discovery, process arguments, Git invocation, and PTY lifecycle.

## Code browsing and review

- Browse lazily reads directory pages and rejects symlink traversal.
- Working review compares `HEAD` with the current working tree.
- History review compares a commit with its first parent; root commits use an empty baseline.
- If a selected directory is nested inside a repository, Git results remain scoped to that
  directory.
- Monaco file and diff models are read-only and are disposed when their tabs or workspace close.

## Terminal

LCoder exposes fixed Shell, Codex, Claude Code, and TraeX profiles rather than renderer-controlled
commands. Terminal processes run in a real PTY with bounded input and output flow control.
Workspace trust is required before a process can start, and trust revocation stops owned sessions.

## Deliberate V1 limits

- macOS Apple Silicon is the tested platform.
- No source editing or Git mutation.
- No pull-request provider integration.
- One terminal session at a time.
- No durable AI conversation store.
