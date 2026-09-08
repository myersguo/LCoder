# Security

## Trust model

Opening a directory allows read-only browsing and Git inspection. Starting any terminal requires
explicit trust for the canonical workspace path. Revoking trust persists the untrusted state before
stopping terminals, and terminal startup is fenced by an epoch so concurrent revocation cancels it.

Trust is a code-execution boundary, not a sandbox. A trusted Shell or AI CLI can execute commands
with the current user's permissions and may modify files.

## Renderer boundary

- The renderer sends opaque workspace/profile IDs and validated relative paths.
- It cannot choose arbitrary commands, arguments, working directories, or Git subcommands.
- Tauri core capabilities are empty; the frontend only uses application commands.
- Filesystem pickers are initiated by Rust.

## Files and Git

- Every path component is checked and symbolic links are not opened.
- Text reads and diffs are size bounded; binary and non-UTF-8 content is not rendered.
- Git uses machine-readable NUL-delimited output, literal pathspecs, bounded output/time, and
  read-only commands.
- Ambient `GIT_*` variables are removed before Git execution, then LCoder adds only its own
  non-interactive safety variables.
- Lazy fetching, external diff drivers, text conversion, replacement objects, prompts, and
  optional locks are disabled.

## AI explanation

Selected text for Explain or Review is capped at 300 lines and 8 KiB, marked as untrusted source in
the prompt, and only sent to Codex, Claude Code, or TraeX. With no selection, LCoder sends the
validated relative path and exact file version reference instead of copying the entire file through
IPC.

## Reporting vulnerabilities

Please do not open a public issue for a vulnerability. Follow the private reporting instructions in
[SECURITY.md](../SECURITY.md).
