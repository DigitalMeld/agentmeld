#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --workspace
node --test experiments/*.test.mjs
python3 scripts/test_seccomp.py
python3 scripts/check-docs.py
