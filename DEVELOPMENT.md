# Clew Development Guide

This document explains how to activate code changes automatically in the plugin inside [Obsidian](https://obsidian.md).

## Prerequisites

### Node.js with nvm

This project uses **nvm** (Node Version Manager). Make sure you have nvm installed. The Node version is pinned in `.nvmrc`.

### 1. Create a test vault

If you do not already have a test vault, create one now (or open your existing test vault):

#### Option A: Using the Obsidian UI

1. Open Obsidian
2. Click the vault icon in the top left
3. Choose **Create new vault**
4. Enter a name (for example, "Plugin Test")
5. Choose a location (for example, `~/dev/obsidian-clew-vault/Plugin-Test`)
6. Click **Create**

#### Option B: Manual (existing vault)

If your test vault already exists, skip this step.

> [!tip]
> Clew is a graph view, so a nearly empty vault shows you almost nothing. Point it at a vault with a few hundred interlinked notes - or your real vault, opened read-only in a copy - to see whether filtering, path-finding, and cluster detection actually behave.

### 2. Link the plugin to Obsidian (symlink)

Create the plugin folder and add a symlink to the vault's plugin directory:

```bash
mkdir -p ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins

ln -s ~/dev/obsidian-clew ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins/clew
```

Verify that the symlink was created correctly:

```bash
ls -la ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins/clew
```

You should see something like this (macOS usually shows the full target path):

```bash
clew -> /Users/christian/dev/obsidian-clew
```

> [!tip]
> It is normal for `ls -la` to show the full path `/Users/...` - this is not a misconfiguration.

> [!important]
> The symlink name must match the `id` in `manifest.json` (`clew`), not the repository name.

### 3. Install project dependencies (important)

Make sure the correct Node version is active and install dependencies:

```bash
nvm use # activate the Node version defined in .nvmrc
npm install # install all dependencies (esbuild, typescript, ...)
```

> [!important]
> `npm run dev` will fail if you do not run `npm install` first.

### 4. Start the development server (watch mode)

Now start the dev server (esbuild in watch mode):

```bash
nvm use
npm run dev
```

> [!tip]
> You can start the dev server before opening the vault; however, it is recommended to create the vault and symlink first so Obsidian loads the correct `main.js`.

This starts **esbuild in watch mode**, which automatically bundles your TypeScript files into `main.js` whenever you save.

### 5. Load the plugin in Obsidian

1. Open Obsidian with your test vault (if it is not already open)
2. Go to **Settings → Community plugins → Installed plugins**
3. Enable the "Clew" plugin if it is disabled

### 6. Reload the plugin after code changes

After every change:

1. Save the file (Cmd+S)
2. Wait about 1-2 seconds for `npm run dev` to bundle the new `main.js`
3. Open the **Command Palette** with Cmd+P
4. Type `Reload` and choose **Reload plugins**

That's it! Your updated plugin is now active.

## Folder structure

```bash
src/
  main.ts                  # plugin entry point and lifecycle management
  settings.ts              # settings interface, defaults, SettingTab UI
  graph/
    generateGraph.ts       # deterministic synthetic graph generator (shared by spike/ and scripts/gen-graph-vault.mjs)
    vaultGraph.ts           # builds a graphology graph from vault files + the link graph
    layoutRunner.ts         # thin wrapper around graphology-layout-forceatlas2's worker-based layout
    renderer.ts             # sigma.js setup, node styling, image-node program
    graphPane.ts             # rendering + find-path UI, composed into the view below
    standaloneGraphView.ts   # the "Graph" view - ribbon icon / "Open graph" command, whole vault
    pathfinding.ts           # Yen's k-shortest-paths, hub-avoidance weighting
    pathfindingModal.ts      # note-picker modal for path finding
    canvasExport.ts          # export a found path as a .canvas file
```

As the plugin grows, keep `main.ts` limited to lifecycle (load/unload, registering
commands and views) and split features into their own modules - see the conventions
and the example layout in [AGENTS.md](AGENTS.md).

## Build commands

| Command | Description |
| --- | --- |
| `npm run dev` | Watch mode for development (esbuild recompiles on changes) |
| `npm run build` | Production build with TypeScript type check and minification |
| `npm run lint` | Run ESLint with Obsidian-specific rules |
| `npm run release` | Build and stage a release into `releases/v<version>/` (local only) |
| `npm run release:publish` | Same, then tag, push, and publish the GitHub release |
| `npm run release:patch` \| `:minor` \| `:major` | Bump the version, build, and publish in one command |
| `npm run spike:build` | Build the standalone graph-rendering spike harness (`spike/`) - see below |
| `npm run gen-test-vault` | Generate the manual-QA vault (`test-vault/`) - see "Manual QA vault" below |

## Testing

Three layers, each catching a different kind of regression:

### 1. Unit tests (functional correctness)

```bash
npm run test        # single run - also runs as part of `npm run lint` and `npm run build`
npm run test:watch  # interactive, re-runs on change
npm run test:coverage
```

[Vitest](https://vitest.dev). Covers the pure graph-algorithm modules directly
(`pathfinding.ts`, `stagnation.ts`, `canvasExport.ts`'s `pathToCanvas`), plus
`vaultGraph.ts` - the actual node/edge-construction pipeline, exercised
against realistic fixtures (hub notes, isolated notes, cross-cluster links
outside the given file set, cover images, directed vs. undirected).

The real `obsidian` npm package is types-only at runtime (`"main": ""` in its
`package.json` - the implementation is injected by the Obsidian app itself),
so any code doing `import { TFile } from 'obsidian'` and using it as a value
(`instanceof TFile`) has nothing to run against in plain Node. `vitest.config.ts`
aliases `'obsidian'` to `test/obsidian-mock.ts`, a deliberately minimal stand-in
(just `TFile`/`TFolder`/`normalizePath` - only what the graph-building code
actually touches). `test/fakeApp.ts` builds a fake `App` on top of it
(`metadataCache.resolvedLinks`, `getFileCache`, `vault.getAbstractFileByPath`,
etc.) from a plain list of `{ path, links, frontmatter, mtime }` fixtures - see
its existing usages in `src/graph/vaultGraph.test.ts` for the pattern.

UI classes (`Modal`, `ItemView`, `Setting`, `Plugin`, ...) are not mocked -
faking enough of Obsidian's UI layer to test those isn't worth it relative to
manual verification in a real vault; the value is in the graph-building logic,
not the chrome around it.

### 2. Performance tests (10,000-node regressions)

```bash
npm run test:perf
```

Deliberately **not** part of `npm run test` (separate `vitest.perf.config.ts`,
separate script) - these assert on wall-clock time, which is inherently
noisier on a shared/loaded CI runner than a correctness assertion, so folding
them into the `lint`/`build` gate would risk making every commit's CI flaky.
Run it explicitly when touching anything perf-sensitive (graph construction,
community detection, pathfinding, layout).

Builds a synthetic 10,000-node graph with the same generator the browser
spike/test-vault scripts use (`generateGraph.ts`, Barabási–Albert
preferential attachment) and asserts generous time budgets around graph
construction, Louvain community detection, a fixed ForceAtlas2 iteration
budget (via the library's plain synchronous API - the Worker-based supervisor
`layoutRunner.ts` uses needs a browser), and k-shortest-paths. All run in
plain Node - no WebGL/rendering involved, since that can't be measured
without a real browser; rendering performance at this scale was validated
manually via the browser harness below and is not covered by an automated
test.

### 3. Manual QA vault

```bash
npm run gen-test-vault   # writes ./test-vault
```

A small (~19-note), hand-designed vault for manually checking each graph
feature actually behaves as expected in real Obsidian - distinct from the
10,000-note performance vault below, and regenerated on demand rather than
committed (mtime is filesystem metadata, not file content, so git can't
preserve "this note is 6 months old" across a clone; the script backdates
specific notes with `fs.utimesSync` instead).

Symlink the plugin into it the same way as [step 2](#2-link-the-plugin-to-obsidian-symlink),
open `test-vault` in Obsidian, then check:

- **Find path**, `Topic A - Detail 1` → `Topic B - Detail 1`: should offer a
  route through `Bridge Note` as an alternative to the naive route through
  `Hub` - the hub-avoidance cost model should make the Bridge Note route rank
  competitively despite `Hub` being the shorter hop count.
- **Find path**, anything → `Island X` or `Island Y`: should report "no path
  found" (a first-class result, not an error) - `Island X`/`Island Y` are a
  deliberately disconnected two-note component.
- **Stagnation heatmap**: `Old Cluster A/B/C` (backdated ~200 days) should be
  the stalest (deep red), `Medium Age A/B` (~45 days) a visibly different
  middling color, everything else fresh (blue) - confirms the color scale
  interpolates rather than being effectively binary.
- **`With Cover`** should render its frontmatter `cover` image as the node,
  not a plain dot.
- **`Isolated`** (no links at all) should render with degree 0 and should
  *not* appear in the stagnation panel's ranked list (communities smaller
  than 2 notes are filtered out there, see `MIN_COMMUNITY_SIZE_SHOWN` in
  `graphPane.ts`) even though it's still colored in the graph itself.
- **Search** (focus mode), typing `Topic`: should highlight `Topic A`,
  `Topic A - Detail 1/2`, `Topic B`, `Topic B - Detail 1`, and `Topic C`
  (forced labels), dim everything else - notes stay visible/positioned, not
  hidden, since this dims rather than filters. Clearing the box should
  restore the normal view. Opening "Find path" or "Stagnation heatmap"
  while a search is active should clear the search box; typing in the
  search box while the heatmap is active should turn the heatmap off (all
  three modes are mutually exclusive).

## Performance testing at scale (rendering)

The stack (Graphology + sigma.js/WebGL + a Web Worker for layout) was validated against a 10,000-node graph before path finding was built on top of it. Two tools from that exercise remain as standing perf-regression checks - useful whenever a rendering or layout change might affect how the graph behaves at vault scale. For the automated, non-rendering side of performance (graph construction, community detection, pathfinding), see "Performance tests" under Testing above.

### 1. Browser harness (no Obsidian needed)

`spike/` renders a synthetic 10,000-node graph in a plain browser tab, using the exact same `src/graph/` modules the real plugin uses:

```bash
npm run spike:build   # bundles spike/main.ts -> spike/dist/bundle.js
```

Then open `spike/index.html` **through a local static server, not a `file://` URL** (script execution and module loading are unreliable for local files in most browser tooling). Any static server works, for example:

```bash
python3 -m http.server 4173 --directory spike
# then open http://localhost:4173
```

The page logs (prefixed `CLEW_SPIKE`) node/edge counts, layout settle time, and a rolling average frame time. A subset of nodes render with a placeholder image, to exercise sigma's image-node program.

### 2. A large test vault (only testable in the app)

```bash
node scripts/gen-graph-vault.mjs   # writes ./spike-vault: 10,000 notes with a hub-heavy link structure
```

1. Symlink the plugin into the generated vault the same way as [step 2](#2-link-the-plugin-to-obsidian-symlink) above, e.g. `ln -s ~/dev/obsidian-clew spike-vault/.obsidian/plugins/clew`, then open `spike-vault` in Obsidian and enable the plugin.
2. Use the ribbon icon or the **"Open graph"** command.
3. Check: pan, zoom, click a node (should select without noticeable lag), and confirm the ~100 image nodes render their cover image - this exercises `app.vault.getResourcePath()` feeding a WebGL texture (the browser harness only proves sigma *can* render images at all, not that a real vault image loads cleanly).

### Known open item

The graph view has not yet been checked on a tablet (Obsidian mobile). Desktop performance has comfortable margin (steady 60fps at 10k nodes), so this isn't currently blocking feature work, but it hasn't been confirmed either - worth doing before relying on mobile behavior for anything.

`spike-vault/` and `spike/dist/` are gitignored - regenerate them locally; they never land in a commit.

## Build production release

### 1. Bump the version

The version number lives in three places: `package.json`, `manifest.json`, and `versions.json`. You can bump it automatically or manually.

#### Option A - automated (`--bump`)

Pass `--bump patch|minor|major` to the release script (or use the matching npm shortcut). This runs `npm version <type>`, which bumps `package.json` and - via the existing `version-bump.mjs` hook - keeps `manifest.json` and `versions.json` in sync, then commits the result as `chore: bump version to vX.Y.Z`:

```bash
bash release.sh --bump patch   # 1.0.1 → 1.0.2 - bug fixes
bash release.sh --bump minor   # 1.0.1 → 1.1.0 - new features, backwards compatible
bash release.sh --bump major   # 1.0.1 → 2.0.0 - breaking changes
```

This requires a clean working tree (commit or stash any pending changes first). The script then continues straight into building (step 2). Combine with `--publish` (or use the `release:patch` / `release:minor` / `release:major` npm scripts below) to bump, build, and publish in one command.

#### Option B - manual

Update `manifest.json` and `package.json` by hand, then commit:

```bash
# Edit version in manifest.json and package.json (e.g. 1.0.0 → 1.1.0)
git add manifest.json package.json
git commit -m "chore: bump version to 1.1.0"
git push
```

### 2. Build and package

Run the release script - it builds the production bundle and copies the three required files into `releases/v<version>/`:

```bash
npm run release
```

Output: `releases/v1.1.0/` containing `main.js`, `manifest.json`, `styles.css`.

### 3. Create a GitHub release

You have two options:

#### Option A - automated (`--publish`)

The release script can also tag, push, and publish the GitHub release for you. This is **optional**: omit `--publish` (or just run `npm run release`) to build locally only.

```bash
npm run release:publish
# equivalent to: bash release.sh --publish

# override the auto-generated notes with your own text:
bash release.sh --publish --notes "Adds path-finding between two notes"
```

**Release notes are generated automatically** from the [Conventional Commits](https://www.conventionalcommits.org/) since the previous tag: `feat:` commits become **Features**, `fix:` commits become **Fixes**, and non-conventional subjects go under **Other** (noise like `chore:` / `ci:` / `test:` / `docs:` is dropped). The script prints a preview before the publish confirmation. Pass `--notes "…"` to override.

To bump the version, build, and publish in a single command, use the combined shortcuts (these chain `--bump <type> --publish`):

```bash
npm run release:patch   # bug fixes
npm run release:minor   # new features
npm run release:major   # breaking changes
```

Before publishing, the script checks that:

- the [GitHub CLI](https://cli.github.com/) (`gh`) is installed and authenticated (`gh auth login`)
- the working tree is clean (the version-bump commit from step 1 must already be in place)
- the tag `<version>` doesn't already exist

It then asks for confirmation (`Publish X.Y.Z to GitHub? [y/N]`) before pushing the tag and creating the release - nothing is pushed without that confirmation, even with `--publish` set.

The release is published directly (not as a draft) with the locally built assets. Publishing fires the "release" event the `Attest release build` workflow needs; it then rebuilds `main.js` in CI, generates a signed build-provenance attestation for all three assets, and re-uploads them - so within about 30 seconds the public release carries CI-built, attested assets rather than the locally-built ones. Verify any asset with `gh attestation verify main.js --repo christian-luger-at/obsidian-clew`.

> [!note]
> Attestation is optional for the community store, but it has a history of tripping up Obsidian's automated review: in July 2026 valid attestations were rejected as cryptographically invalid because GitHub's attestation API had changed its response format (`bundle` → `bundle_url`) and the review scanner hadn't caught up. Several plugins were delisted before an Obsidian moderator confirmed and fixed it. If a review ever flags the attestation, check the Obsidian forum before assuming `attest.yml` is at fault.

> [!important]
> The release tag must match the `version` in `manifest.json` **exactly, without a `v` prefix** (e.g. `1.1.0`, not `v1.1.0`). Obsidian's community-plugin store and the in-app auto-updater only recognise releases tagged this way. `release.sh` already tags without the prefix.

#### Option B - manual

```bash
# Create a git tag that exactly matches the manifest version - no "v" prefix
git tag 1.0.0
git push origin 1.0.0

# Create the GitHub release and attach the three plugin files
gh release create 1.0.0 \
  releases/v1.0.0/main.js \
  releases/v1.0.0/manifest.json \
  releases/v1.0.0/styles.css \
  --title "1.0.0" \
  --notes "Initial release"
```

Either way, the release is now visible on GitHub with the three files as downloadable artifacts.

> [!tip]
> To install the release in Obsidian manually: download all three files and place them in `.obsidian/plugins/clew/` inside your vault.

## Download statistics

Once the plugin is in the community store, `scripts/release-stats.sh` prints
per-version download counts from both sources - the Obsidian store and the GitHub
release assets (manual and BRAT installs):

```bash
./scripts/release-stats.sh
```

It needs `jq`. Export `GITHUB_TOKEN` to avoid the GitHub API rate limit.

## Submit the plugin to the Obsidian Community store

Getting the plugin into the in-app **Community Plugins** browser is a **one-time** pull request against Obsidian's registry. The store serves the very same GitHub release artifacts, so a single correctly-tagged release (see step 3 above - tag **without** the `v` prefix) covers both manual installs and the store.

### Before you submit - checklist

Submissions are checked by an automated bot **and** a human reviewer. Make sure:

- **`manifest.json`** sits in the repo root with a unique `id` (lowercase, hyphenated, no spaces, and must not contain `obsidian` or `plugin`), a `name` that doesn't start with "Obsidian", a concise `description` that doesn't start with the plugin name, plus `author`, `minAppVersion`, and `isDesktopOnly`.
- **`minAppVersion`** is accurate - it must not claim support for Obsidian versions that predate the APIs the plugin uses.
- **`versions.json`** maps each released plugin version to its minimum Obsidian version.
- A **`LICENSE`** file and a **`README.md`** (what it does + how to use it) exist.
- No leftover sample-plugin code, no `console.log`, no obfuscated code - the source is public and reviewable.
- A **GitHub release** exists whose **tag equals the `manifest.json` version exactly, with no `v` prefix** (e.g. `1.0.0`), with `main.js`, `manifest.json`, and `styles.css` attached as assets.

Run `npm run lint` and `npm run build`, then cut the release with `npm run release:publish` (or `release:patch` / `release:minor` / `release:major`).

### First-time submission (one-off)

1. Cut the release (above) so the tag and the three assets exist.
2. Fork [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) and append your plugin to the **end** of `community-plugins.json`:

   ```json
   {
     "id": "clew",
     "name": "Clew",
     "author": "Christian Luger",
     "description": "See your whole vault as a graph and find how any two notes connect, without every path routing through your index notes.",
     "repo": "christian-luger-at/obsidian-clew"
   }
   ```

   - `repo` is the `user/repo` slug - **not** a full URL.
   - Keep the JSON valid and don't reorder existing entries.
3. Open a **pull request** to `obsidianmd/obsidian-releases` and fill in the PR template (it asks you to confirm the checklist).
4. The **automated bot** validates the repo and release - fix anything it flags. Then a **maintainer reviews the code manually**; depending on the queue this can take days to a few weeks.
5. Once the PR is merged, the plugin shows up in **Settings → Community plugins → Browse** for everyone.

### Ongoing updates (after acceptance)

No further PR is ever needed. For each update:

1. Bump `manifest.json` **and** `versions.json` (the `--bump` flag does both).
2. Cut a new release tagged with the exact new version, no `v` prefix, with the three assets - e.g. `npm run release:patch` / `release:minor` / `release:major`.
3. Obsidian clients detect the new release automatically and offer the update.

> [!important]
> The plugin `id` is **permanent** once accepted - changing it later breaks users' saved settings and the update path. Double-check `id` (and that it's unique in `community-plugins.json`) before submitting.

## Additional resources

- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Obsidian API Docs](https://docs.obsidian.md)
- [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Submit your plugin (official guide)](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Community plugins registry (`obsidian-releases`)](https://github.com/obsidianmd/obsidian-releases)
