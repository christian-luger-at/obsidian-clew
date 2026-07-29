#!/usr/bin/env bash
set -euo pipefail

# Copies the current build into the maintainer's personal vault
# ("Vault-Private", an iCloud-synced vault - not the disposable QA vaults
# test-vault/spike-vault use symlinks for, see DEVELOPMENT.md). A real copy
# on purpose, not a symlink: a personal vault shouldn't start running
# whatever's currently on disk mid-build every time `npm run build` runs -
# re-run this script explicitly whenever a build is actually ready to try
# there.
#
# The default path only makes sense on the maintainer's own machine;
# override it with an argument if you're not them, e.g.:
#   scripts/sync-private-vault.sh ~/some/other/vault

DEFAULT_VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault-Private"
VAULT="${1:-$DEFAULT_VAULT}"
PLUGIN_DIR="$VAULT/.obsidian/plugins/clew"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building Clew..."
(cd "$REPO_ROOT" && npm run build)

mkdir -p "$PLUGIN_DIR"
cp "$REPO_ROOT/main.js" "$REPO_ROOT/manifest.json" "$REPO_ROOT/styles.css" "$PLUGIN_DIR/"

echo ""
echo "Synced to $PLUGIN_DIR"
ls -la "$PLUGIN_DIR"
