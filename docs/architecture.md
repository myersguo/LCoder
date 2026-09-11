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

- Browse lazily reads directory pages and rejects symlink traversal. Its file
  filter performs a bounded Rust-side recursive filename/path search so matches
  can be found without first expanding every directory.
- Working review compares `HEAD` with the current working tree.
- History review compares a commit with its first parent; root commits use an empty baseline.
- Branch review compares a selected local head branch against the merge-base
  with a selected local base branch, matching common feature-to-main review
  semantics.
- If a selected directory is nested inside a repository, Git results remain scoped to that
  directory.
- Monaco file and diff models are read-only and are disposed when their tabs or workspace close.

## Terminal

LCoder exposes fixed Shell, Codex, Claude Code, and TraeX profiles rather than renderer-controlled
commands. Terminal processes run in a real PTY with bounded input and output flow control.
Workspace trust is required before a process can start, and trust revocation stops owned sessions.

AI profiles are temporary by default. Claude Code uses its interactive
no-transcript environment mode. Codex and TraeX keep rollout/session/SQLite
state in a private per-session LCoder directory, while fixed symlinks expose
only the existing configuration, authentication, and Agent resources needed
by the CLI. The directory is removed with the owned process, so these runs do
not enter the Agent's default Recent/resume store. LCoder does not inspect or
delete existing Agent sessions.

Monaco AI actions reuse that PTY. Explain and Review share the same bounded selection or exact
file-version context, but use separate prompts: Explain describes behavior, while Review asks only
for actionable correctness, security, concurrency, lifecycle, performance, and maintainability
findings.

## Deliberate V1 limits

- macOS Apple Silicon is the tested platform.
- No source editing or Git mutation.
- No pull-request provider integration.
- One terminal session at a time.
- No durable AI conversation store.
