# LCoder

LCoder is a focused local code-reading and Git review workbench built with Rust, Tauri 2, React,
Monaco Editor, xterm.js, and `portable-pty`.

## Features

- Open a local directory with the native picker.
- Browse a lazy-loaded, read-only file tree.
- Filter workspace files recursively or narrow the current Review change list.
- Keep the currently active file visibly highlighted in Browse, Working
  Changes, and the matching History commit tree.
- Read UTF-8 source in Monaco.
- Review the current `HEAD → working tree` change set.
- Browse commit history and first-parent commit diffs.
- Compare local branches with `base...head` semantics for feature-branch review.
- Right-click a file or either side of a diff to explain or review selected
  code; with no selection, the action targets the exact entire file/version.
- Run Shell, Codex, Claude Code, or TraeX in a real embedded PTY.
- Keep AI sessions started by LCoder out of each Agent's default
  Recent/resume list.
- Refresh files and Git state when the workspace changes.
- Keep browsing safe until the user explicitly trusts the workspace for command execution.

## Install

macOS Apple Silicon:

```bash
curl -fsSL https://raw.githubusercontent.com/myersguo/LCoder/main/install.sh | bash
```

The script downloads the latest release, verifies it against the published `SHA256SUMS`, installs
`LCoder.app` in `/Applications`, and launches it. Or install with Homebrew:

```bash
brew install --cask myersguo/tap/lcoder
```

Current builds are ad-hoc signed but not Developer ID signed or notarized. If Homebrew leaves the
download quarantined and macOS blocks first launch, clear quarantine for LCoder only:

```bash
xattr -dr com.apple.quarantine "/Applications/LCoder.app"
```

Manual downloads and checksums are available on the
[Releases](https://github.com/myersguo/LCoder/releases) page.

## Supported platform

- macOS 13+ on Apple Silicon is the supported V1 target.

Other Tauri-supported desktop platforms are not currently tested.

## Prerequisites

- Rust stable, Node.js 22+, pnpm 9+, and Git.
- Codex, Claude Code, and TraeX are optional and detected independently.

## Get started

```bash
git clone https://github.com/myersguo/LCoder.git
cd LCoder
pnpm install
pnpm tauri dev
```

For browser-only UI development:

```bash
pnpm dev:demo
```

The browser demo uses a clearly labeled sample workspace because browser pages cannot access the
native filesystem or PTY. Production builds use Rust commands through typed Tauri IPC.

## Verification

```bash
pnpm audit --audit-level moderate
pnpm verify
pnpm tauri build --bundles app
```

Core Git tests use disposable real repositories. They do not read or modify user projects or AI
session stores.

## Security and product boundaries

- The Monaco surface is read-only.
- Review never stages, discards, commits, checks out, fetches, or mutates Git state.
- Terminal profiles are fixed; the renderer cannot provide arbitrary executables or arguments.
- Selection explanations are capped at 300 lines and 8 KiB, treat selected
  source as untrusted data, and are never sent to the plain Shell profile.
- Entire-file explanations send only the validated relative path and exact
  working-tree/HEAD/commit version reference, so history review is not
  accidentally explained from the current file.
- Navigator and Terminal panes are continuously resizable and persist their
  latest widths. The complete AI Terminal surface and xterm palette follow
  LCoder's light/dark theme.
- In History, the commit list and changed-file tree have a persisted,
  keyboard-accessible horizontal resize handle.
- Source text, diffs, terminal bytes, and AI messages are not persisted by LCoder.
- Codex and TraeX session/SQLite state is written to a private disposable
  LCoder directory while existing user config and authentication remain
  available. Claude Code runs with interactive transcript persistence
  disabled. LCoder never deletes or edits the user's existing Agent sessions.

See [Architecture](docs/architecture.md), [Security](docs/security.md), and
[Contributing](CONTRIBUTING.md) for more detail.

## License

[MIT](LICENSE)
