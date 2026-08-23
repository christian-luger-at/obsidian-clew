# Clew Development Guide

This document explains how to set up a dev environment, run the tests, verify a change manually, and cut a release. For architecture rationale and historical design decisions, see the git log - this file describes how things work *now*, not how they got here.

## Setup

### 1. Node.js

This project uses **nvm**; the version is pinned in `.nvmrc`.

```bash
nvm use
npm install
```

### 2. Create a test vault and symlink the plugin

```bash
mkdir -p ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins
ln -s ~/dev/obsidian-clew ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins/clew
```

> [!important]
> The symlink name must match `manifest.json`'s `id` (`clew`), not the repo name.

> [!tip]
> Clew is a graph view - a nearly empty vault shows almost nothing. Point it at a vault with a few hundred interlinked notes (or a copy of your real vault) to see filtering/path-finding/clustering actually behave.

### 3. Start the dev server

```bash
npm run dev
```

esbuild watch mode - rebuilds `main.js` on every save.

### 4. Load and reload the plugin

1. Open the test vault in Obsidian, enable "Clew" under **Settings → Community plugins**.
2. After a code change: save, wait ~1-2s for the rebuild, then Cmd+P → **Reload plugins**.

Nearly every file under `src/` opens with a docstring explaining what it does and why - `ls src/graph/` plus those is a more reliable map than a hand-maintained tree here would stay. Keep `main.ts` limited to lifecycle; split features into their own modules - see [AGENTS.md](AGENTS.md) for conventions.

## Build commands

| Command | Description |
| --- | --- |
| `npm run dev` | Watch mode |
| `npm run build` | Type-check + production build |
| `npm run lint` | ESLint (Obsidian ruleset) + tests |
| `npm run release` / `release:publish` / `release:patch` / `:minor` / `:major` | See [Release](#release) |
| `npm run gen-test-vault` | Regenerate the manual-QA vault (`test-vault/`) |
| `npm run gen-history-vault` | Regenerate the ~290-note demo vault docs screenshots use |
| `npm run docs:shots` / `docs:shots:showcase` | Regenerate docs site screenshots / the external showcase GIF |
| `npm run sync-private-vault [-- <path>]` | Build, then copy the three plugin files into a real vault (a copy, not a symlink) |
| `npm run spike:build` | Build the standalone rendering perf harness (`spike/`) |

## Testing

### 1. Unit tests

```bash
npm run test         # single run
npm run test:watch
npm run test:coverage
```

[Vitest](https://vitest.dev). Covers every pure graph-algorithm module (`pathfinding.ts`, `stagnation.ts`, `diagnostics.ts`, `egoGraph.ts`, `graphAnalytics.ts`, `nodeGroups.ts`, `filter.ts`, `semanticClustering.ts`, `vaultGraph.ts`, layout modules, `visibilityFade.ts`, `embedConfig.ts`, ...) - coverage-enforced, 85%/80% per file.

UI classes (`GraphPane`, `StandaloneGraphView`, `renderer.ts`, `main.ts`, `settingsTab.ts`) are **not** unit tested - faking enough of Obsidian's UI layer isn't worth it relative to manual QA below. If a future feature adds pure logic, it goes through the same test+coverage bar as the list above; UI wiring goes through manual QA instead.

The real `obsidian` npm package is types-only at runtime - `vitest.config.ts` aliases it to `test/obsidian-mock.ts` (`TFile`/`TFolder`/`normalizePath`), and `test/fakeApp.ts` builds a fake `App` on top of it from plain `{ path, links, frontmatter, mtime }` fixtures. Reuse this pattern for anything needing `App`/`TFile` in a test.

### 2. Performance tests (10,000-note regressions)

```bash
npm run test:perf
```

Separate from `npm run test` (wall-clock assertions are noisier on CI than correctness assertions). Run explicitly when touching graph construction, community detection, pathfinding, or layout. Builds a synthetic 10k-node graph (`generateGraph.ts`, Barabási–Albert) and asserts generous time budgets - no WebGL/rendering involved (see [TESTING.md's rendering-at-scale section](TESTING.md#rendering-at-scale) for that).

### 3. Manual QA and rendering at scale

Panel-by-panel behavior checklist, the large-vault/tablet rendering checks, and the manual-QA vault setup all moved to [TESTING.md](TESTING.md) - consult it before a release or when verifying a UI-facing change by hand.

## Release

### 1. Bump the version

Lives in `package.json`, `manifest.json`, `versions.json`.

```bash
bash release.sh --bump patch   # bug fixes
bash release.sh --bump minor   # new features, backwards compatible
bash release.sh --bump major   # breaking changes
```

Requires a clean working tree; commits as `chore: bump version to vX.Y.Z`, then continues into building.

### 2. Build and package

```bash
npm run release
```

Writes `releases/v<version>/` (`main.js`, `manifest.json`, `styles.css`).

### 3. Publish

```bash
npm run release:publish            # build (if not already) + tag + push + GitHub release
npm run release:patch / :minor / :major   # bump + build + publish in one command
```

Release notes auto-generate from [Conventional Commits](https://www.conventionalcommits.org/) since the last tag (`feat:`→Features, `fix:`→Fixes, everything else→Other); pass `--notes "…"` to override. Requires the [GitHub CLI](https://cli.github.com/) authenticated, a clean tree, and asks for confirmation before pushing anything.

Publishing triggers the `Attest release build` CI workflow, which rebuilds `main.js`, generates a signed build-provenance attestation for all three assets, and re-uploads them - within ~30s the public release carries CI-built, attested assets. Verify with `gh attestation verify main.js --repo christian-luger-at/obsidian-clew`.

> [!important]
> The release tag must match `manifest.json`'s version **exactly, no `v` prefix** (`1.1.0`, not `v1.1.0`) - Obsidian's store and auto-updater only recognize releases tagged this way. `release.sh` already does this.

> [!note]
> Attestation is optional for the community store but has a history of false-positive rejections (a GitHub API response-format change in July 2026 broke Obsidian's review scanner before a moderator fixed it). If a review flags the attestation, check the Obsidian forum before assuming `attest.yml` is at fault.

## Download statistics

```bash
GITHUB_TOKEN=... scripts/release-stats.sh
```

Prints per-version download counts from both the Obsidian store and GitHub release assets (manual/BRAT installs). Needs `jq`; `GITHUB_TOKEN` avoids the GitHub API rate limit.

## Community store

Clew is already accepted into Obsidian's community store (the one-time registry PR is done and won't be repeated) - it serves the same GitHub release artifacts a manual install uses, so every correctly-tagged release just shows up there automatically, no further PR ever needed.

- `manifest.json`: `minAppVersion` reflects only the APIs actually used - don't bump it preemptively; `versions.json` must map every released version to its minimum Obsidian version.
- Run `npm run lint && npm run build`, then cut the release (above).

> [!important]
> The plugin `id` is permanent - changing it breaks users' saved settings and the update path.

## Additional resources

- [Obsidian API Docs](https://docs.obsidian.md)
- [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Community plugins registry](https://github.com/obsidianmd/obsidian-releases)
