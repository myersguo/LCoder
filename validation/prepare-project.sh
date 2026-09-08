#!/usr/bin/env bash
set -euo pipefail

target=${1:?usage: prepare-project.sh TARGET_DIRECTORY}

if [[ "$target" != /tmp/lcoder/* ]]; then
  echo "refusing to create a validation project outside /tmp/lcoder" >&2
  exit 1
fi

mkdir -p "$target/src/parser" "$target/tests"
git -C "$target" init --initial-branch=main
git -C "$target" config user.name "LCoder Validation"
git -C "$target" config user.email "lcoder-validation@example.invalid"

cat > "$target/src/parser/lexer.rs" <<'EOF'
pub fn tokenize(source: &str) -> Vec<&str> {
    source.split_whitespace().collect()
}
EOF
cat > "$target/src/lib.rs" <<'EOF'
pub mod parser;
EOF
cat > "$target/README.md" <<'EOF'
# LCoder validation
EOF
git -C "$target" add .
git -C "$target" commit -m "initial fixture"

cat > "$target/src/parser/lexer.rs" <<'EOF'
pub fn tokenize(source: &str) -> Vec<&str> {
    source
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .collect()
}
EOF
cat > "$target/tests/parser_test.rs" <<'EOF'
#[test]
fn tokenizes_words() {
    assert_eq!(2, 2);
}
EOF
