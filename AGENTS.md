# LCoder contribution notes

- Keep the V1 code viewer and Git review surfaces read-only.
- Renderer code must use opaque workspace/profile IDs and relative paths. Absolute filesystem,
  process, and Git authority remains in Rust.
- Do not add a generic shell command, generic filesystem command, or renderer-controlled argv.
- Use real disposable Git repositories and PTYs for integration tests. Never test against user
  projects or existing AI sessions.
- JavaScript package management uses pnpm.
- Before delivery run `pnpm verify`; system integrations also require a real desktop smoke.
