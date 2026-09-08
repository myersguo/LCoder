# Contributing

## Development

Requirements: macOS 13+ on Apple Silicon, Rust stable, Node.js 22+, pnpm 9+, and Git.

```bash
pnpm install
pnpm tauri dev
```

Use `pnpm dev:demo` for browser-only UI work.

The optional browser smoke requires Python Playwright:

```bash
python3 -m venv .venv
.venv/bin/pip install playwright
pnpm dev:demo
.venv/bin/python validation/browser-smoke.py
```

## Before opening a pull request

```bash
pnpm audit --audit-level moderate
pnpm verify
pnpm tauri build --bundles app
```

Changes to native behavior also need a real desktop smoke test. Git and PTY integration tests must
use disposable fixtures and must not touch user projects or existing AI sessions.

## Scope and safety

- Keep code browsing and review read-only.
- Do not add a generic shell command, filesystem command, or renderer-controlled argument vector.
- Keep absolute paths, Git invocation, executables, and process authority in Rust.
- Preserve workspace trust as the command-execution boundary.
- Avoid unrelated refactors in focused changes.
