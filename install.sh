#!/usr/bin/env bash
# LCoder installer for macOS (Apple Silicon).
#
#   curl -fsSL https://raw.githubusercontent.com/myersguo/LCoder/main/install.sh | bash
#
# Downloads the latest GitHub release, verifies its SHA-256, installs the app,
# clears quarantine for this app bundle only, and launches it.
# Set LCODER_INSTALL_FORCE=1 to replace an existing install without prompting.
set -euo pipefail

REPO="myersguo/LCoder"
APP_DIR="${LCODER_INSTALL_DIR:-/Applications}"
APP_PATH="$APP_DIR/LCoder.app"

fail() {
  echo "error: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "LCoder binaries are published for macOS only."
[[ "$(uname -m)" == "arm64" ]] || fail \
  "only Apple Silicon binaries are published; build from source instead: https://github.com/$REPO#prerequisites"
for command in curl ditto shasum; do
  command -v "$command" >/dev/null || fail "$command is required"
done

echo "Looking up the latest LCoder release…"
tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  "https://github.com/$REPO/releases/latest" | sed 's#.*/tag/##')
[[ "$tag" == v* ]] || fail "could not resolve the latest release tag"
version=${tag#v}
zip_name="LCoder-$version-macos-arm64-unsigned.zip"
asset_base="https://github.com/$REPO/releases/download/$tag"

workdir=$(mktemp -d /tmp/lcoder-install.XXXXXX)
trap 'rm -rf "$workdir"' EXIT

echo "Downloading LCoder $version…"
curl -fsSL -o "$workdir/SHA256SUMS" "$asset_base/SHA256SUMS" \
  || fail "release $tag has no SHA256SUMS asset"
curl -fSL --progress-bar -o "$workdir/$zip_name" "$asset_base/$zip_name"

expected=$(awk -v name="$zip_name" '$2 == name { print $1; exit }' "$workdir/SHA256SUMS")
[[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || fail "release checksum is missing or invalid"
actual=$(shasum -a 256 "$workdir/$zip_name" | awk '{ print $1 }')
[[ "$actual" == "$expected" ]] || fail "checksum verification failed — aborting before touching $APP_PATH"

if [[ -e "$APP_PATH" && "${LCODER_INSTALL_FORCE:-0}" != "1" ]]; then
  if [[ -r /dev/tty ]]; then
    read -r -p "$APP_PATH already exists. Replace it? [y/N] " answer < /dev/tty
    [[ "$answer" == "y" || "$answer" == "Y" ]] || fail "cancelled"
  else
    fail "$APP_PATH already exists; re-run with LCODER_INSTALL_FORCE=1 to replace it"
  fi
fi

ditto -xk "$workdir/$zip_name" "$workdir/extracted"
[[ -d "$workdir/extracted/LCoder.app" ]] || fail "unexpected archive layout"
mkdir -p "$APP_DIR"
rm -rf "$APP_PATH"
ditto "$workdir/extracted/LCoder.app" "$APP_PATH"

# Releases are ad-hoc signed but not notarized. Limit quarantine removal to the
# installed LCoder bundle; never weaken Gatekeeper or SIP globally.
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

echo "Installed LCoder $version at $APP_PATH"
if [[ "${LCODER_INSTALL_NO_LAUNCH:-0}" != "1" ]]; then
  open "$APP_PATH"
fi
