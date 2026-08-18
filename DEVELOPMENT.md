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

## Folder structure

```
src/
  main.ts                  # plugin entry point, lifecycle, global error listeners
  settings.ts               # persisted settings shape + defaults
  settingsTab.ts             # Settings → Community plugins → Clew
  errorReporting.ts           # console + optional copyable Notice for Clew's own errors
  graph/
    vaultGraph.ts             # builds a graphology graph from vault files + links
    graphPane.ts               # the graph view's rendering + every panel (toolbar, Filter, Color & size, Diagnostics, Focus, Find path, Timeline, Appearance, Saved views)
    standaloneGraphView.ts     # the ItemView hosting GraphPane (ribbon icon / "Open graph view")
    graphEmbed.ts              # ```clew-graph code-fence embed
    renderer.ts                 # sigma.js setup, node/edge programs
    layoutRunner.ts              # ForceAtlas2 (Worker-based)
    hierarchicalLayout.ts / radialLayout.ts / circularLayout.ts / timelineLayout.ts
    nodeGroups.ts               # Color & size / Filter's shared criteria engine
    filter.ts                    # FilterPreset on top of nodeGroups.ts
    pathfinding.ts               # Yen's k-shortest-paths, hub-avoidance weighting
    diagnostics.ts                # orphans / broken links / isolated clusters
    egoGraph.ts                   # BFS ego-network (Focus panel)
    graphAnalytics.ts              # betweenness / PageRank wrappers
    stagnation.ts                  # Louvain communities, staleness, structural deviation
    semanticClustering.ts / embeddingModel.ts  # local-embedding note clustering
    theme.ts                       # Obsidian CSS-variable → graph color mapping
    timeline.ts                    # ctime-based replay
    visibilityFade.ts               # Filter/Focus's shared fade-in/out tracker
```

Keep `main.ts` limited to lifecycle; split features into their own modules - see [AGENTS.md](AGENTS.md) for conventions.

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

Separate from `npm run test` (wall-clock assertions are noisier on CI than correctness assertions). Run explicitly when touching graph construction, community detection, pathfinding, or layout. Builds a synthetic 10k-node graph (`generateGraph.ts`, Barabási–Albert) and asserts generous time budgets - no WebGL/rendering involved (see [Rendering at scale](#rendering-at-scale) below for that).

### 3. Manual QA vault

```bash
npm run gen-test-vault   # writes ./test-vault, ~19 hand-designed notes
```

Symlink the build output **file by file** (not the whole directory - `test-vault` needs its own `data.json`):

```bash
mkdir -p test-vault/.obsidian/plugins/clew
ln -s "$PWD/main.js" "$PWD/manifest.json" "$PWD/styles.css" test-vault/.obsidian/plugins/clew/
```

Every `npm run build` after that updates the vault automatically. Open `test-vault` in Obsidian and work through:

**Toolbar / panel plumbing**
- Only one panel open at a time - opening any of Filter/Color & size/Appearance/Diagnostics/Find path/Layout/Focus/Saved views closes whichever else was open.
- Each toolbar icon lights up (solid accent) exactly while its own state is actually active (a filter enabled, Find-path showing a result, Focus applied, ...), not just while its panel happens to be open.
- Reload the plugin - filters, color groups, pinned node positions, Timeline picks, Saved views, and pathfinding exclusions all survive; the Timeline scrubber's own position does not (always restarts at the beginning).

**Find path** (route icon - gated by `FIND_PATH_ENABLED` in `graphPane.ts`)
- Reopening the dialog while a result is showing pre-fills From/To/Directed; closing the result or opening it fresh clears them.
- A real route (e.g. through a deliberately-planted `Bridge Note`) should favor hub-avoidance over the shortest hop count. "Shortest" + up to 3 "Alt N" pills; clicking one re-highlights just that route.
- Two genuinely disconnected notes report "no path found" as a normal result, not an error.
- Excluding a note/folder in Settings while a result is showing re-runs the search live (not just the ring).

**Focus** (crosshair icon)
- Picking a note applies immediately (no Apply button); raising Hops updates live. Exclusive with Filter/Find-path/Diagnostics highlight - whichever activates last wins, no stacking.

**Diagnostics** (stethoscope icon)
- Orphans / Broken links / Isolated clusters / Structural deviation each list correctly against the seeded test-vault notes (`Isolated`, `Hub → Nonexistent Note`, `Island X`/`Island Y`, the `Scattered *` cluster).
- Isolated clusters / Structural deviation: no member list, just a count + a highlighter/eraser toggle that spotlights the cluster on the graph.
- Per-section on/off toggles live in Obsidian's own Settings tab, take effect immediately.
- Large lists paginate ("+ N more") rather than rendering unprompted.

**Filter** and **Color & size** (funnel / palette icons - both built on `nodeGroups.ts`'s shared criteria engine)
- Create/rename/reorder (drag handle)/delete/enable-toggle a filter or group; every field saves immediately, no separate Save step.
- Criteria render as one-line chips, click to expand into full controls; "x" while editing reverts (not deletes), "x" on a just-added criterion removes it.
- Typing into a text-valued field (name, `folder`/`property`/`text`/`filename` value, `staleDays`/`minLinks`) live-applies debounced (~400ms after the last keystroke, not per keystroke); dropdown/toggle/note-picker criteria apply instantly.
- Filter: "Show if it matches" (At least one / Every filter) controls how several *enabled* filters combine; drag-reordering filters has no effect on matching (unlike Color & size, where order is match precedence).
- Color & size: "Scale size" (behind the "..." menu) multiplies a matching note's existing degree-based size, doesn't replace it. Max 10 groups / 10 filters (`MAX_NODE_GROUPS`/`MAX_FILTER_PRESETS`).
- Criterion types: Tag, Property (with Contains/Equals/Not equals/Is empty/Is not empty), Folder (includes subfolders), Filename, Text (title + body, only reads note content when at least one enabled criterion needs it), Not-edited-in-days, Minimum links, Node type (note/tag/attachment/nonexistent link), Activity (a community's staleness vs. the vault), Structure (a community's folder-scatter), Bridging (betweenness), Prominence (PageRank), Connectivity (isolated component), Community, Semantic cluster.
- Community/Semantic cluster: picking a note only sets the display label, never auto-changes the group's own color - color is always a manual, explicit pick.
- Most criteria show a clickable `is`/`is not` (or equivalent) word for negation; Property/Activity/Structure don't need one (their own dropdown already covers it).

**Appearance** (sliders icon)
- Node/edge size, physics (Force), spacing (Radial/Hierarchical/Circular/Timeline - only the active layout's group shows), label density/threshold, edge style, "Show as nodes" (tags/attachments/non-existent links, each off by default and rebuilding the graph when toggled), cluster-heatmap toggle. "Pinned node positions" count + "Clear all" updates live while dragging a node with the panel open.

**Layouts** (Layout dialog)
- Force (default, physics-clustered, deterministic starting positions), Hierarchical (top-down by link direction, disabled above `HIERARCHICAL_LAYOUT_NODE_LIMIT` notes), Radial (rings from a picked note; always opens a note-picker), Circular (one ring, breadth-first ordering), Timeline (X = real elapsed time since the vault's earliest note, ctime-only same as the Timeline scrubber; notes sharing a day stack in one column). Switching back to Force restarts from the same deterministic seed, not wherever the previous layout left nodes.

**Timeline** (history icon)
- Scrubber starts at the oldest note, not "today". New notes/edges grow in over ~400ms, not popping in at full size. Duration (10s/30s/1min/3min) always paces the *whole* vault's history evenly regardless of real date spread; the pace-mode toggle switches to real-calendar-time spacing instead. Combines with an active filter (intersection, not override). A vault where every note shares one ctime disables Play with an explanation instead of silently doing nothing.

**Saved views** (bookmark icon)
- Save captures the current filter/group/layout/focus combination by value (not by reference to today's filter/group ids); applying one restores it exactly; updating only works on the currently-applied view.

**Interaction**
- Click opens the note; hover highlights its neighbors (composes with whatever mode is active, restores it on mouseleave). Drag pins a node (Force layout only) - neighbors visibly resettle, position persists across a reload; a plain click doesn't pin.
- Whichever note is the app-wide active file gets a persistent ring (any leaf, not just this view's own tab) and the camera pans to it - opening a note elsewhere, or switching tabs, keeps the graph in sync. Filter and Focus fade notes/edges in and out (~400ms) instead of an instant hide, same transition speed Timeline's own grow-in uses.
- Idle physics (Appearance panel, off by default): keeps ForceAtlas2 running indefinitely after the settle instead of killing the supervisor, plus a periodic small random nudge per non-fixed node (`IDLE_PHYSICS_NUDGE_MS`/`IDLE_PHYSICS_JITTER`) - FA2 alone has no "reheat," so left alone it would just sit numerically still once converged; the nudge supplies the motion, FA2 pulls things back into shape afterward. Paused during a drag (would otherwise fight the manual move), resumes once the post-drag re-settle finishes.
- Theme switch (light/dark/community theme) updates graph colors live, no reload.
- Empty states: no notes in the vault vs. a filter matching nothing show distinct explanatory cards, not a blank canvas.

**Code-fence embed** (` ```clew-graph ` in any note - see `graphEmbed.ts`/`embedConfig.ts`)
- `node:` (required, resolved like a `[[wikilink]]`), `hops:` (1-3, default 1), `width:`/`height:` (CSS length; no width → 100%, no height → 16:9), `refresh:` (shows a manual refresh button). Renders Radial-centered on `node:`, never inherits the vault's real filters/colors/pinned positions. Missing/unresolvable `node:` renders a red inline error, not a crash.

**Error notifications** (Settings → Community plugins → Clew → "Debug" - see `errorReporting.ts`)
- Off by default. Every unexpected error inside Clew's own code always goes to the console regardless; turning "Show error notifications" on additionally shows a sticky, copyable `Notice` (context + message + stack) for it. An error from Obsidian core or a different plugin never triggers one, either way - filtered by the `plugin:clew` source name Obsidian's own loader stamps onto this plugin's bundled code.

## Rendering at scale

Validated once against a 10,000-node graph; two tools remain as standing regression checks for any rendering/layout change (see [Performance tests](#2-performance-tests-10000-note-regressions) above for the non-rendering, automated side).

**Browser harness (no Obsidian needed)**:

```bash
npm run spike:build
python3 -m http.server 4173 --directory spike   # not file:// - module loading needs a real server
# open http://localhost:4173
```

Renders a synthetic 10k-node graph using the real `src/graph/` modules; the on-screen HUD logs settle time and rolling frame time.

**A large test vault (only testable in the real app)**:

```bash
node scripts/gen-graph-vault.mjs   # writes ./spike-vault
```

Symlink the plugin the same file-by-file way as `test-vault` above, open it, and confirm pan/zoom/click stay smooth and the ~100 cover-image notes render their image (exercises `app.vault.getResourcePath()` feeding a real WebGL texture, which the browser harness alone doesn't prove).

`spike-vault/` and `spike/dist/` are gitignored.

**Verified on a real tablet** (iPad, Obsidian mobile, GitHub issue #7, closed): the standalone graph view opens and renders, the ForceAtlas2 layout Worker spawns and runs fine on iOS Safari's WebView (Blob-URL construction was the one open risk - it's not one in practice), WebGL performance and pan/zoom/tap feel are all fine, and drag-to-pin works correctly (see `setupNodeDragging()`'s captor-agnostic `renderer.on('moveBody', ...)` plus the touch captor's own `touchup` - this was the one real bug the touch gap exposed, fixed before this verification). Hover-tooltips and hover-highlight-neighbors also work as expected on tap.

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

Once the plugin is in the community store:

```bash
GITHUB_TOKEN=... scripts/release-stats.sh
```

Prints per-version download counts from both the Obsidian store and GitHub release assets (manual/BRAT installs). Needs `jq`; `GITHUB_TOKEN` avoids the GitHub API rate limit.

## Submit the plugin to the Obsidian Community store

A **one-time** pull request against Obsidian's registry - the store serves the same GitHub release artifacts a manual install uses, so one correctly-tagged release covers both.

### Checklist

- `manifest.json`: unique lowercase-hyphenated `id` (no `obsidian`/`plugin` in it), a `name` not starting with "Obsidian", a `description` not starting with the plugin name, plus `author`/`minAppVersion`/`isDesktopOnly`.
- `minAppVersion` reflects only the APIs actually used - don't bump it preemptively.
- `versions.json` maps every released version to its minimum Obsidian version.
- `LICENSE` and `README.md` exist.
- No leftover sample-plugin code, no `console.log`, nothing obfuscated.
- A GitHub release tagged exactly as the manifest version (no `v`), with `main.js`/`manifest.json`/`styles.css` attached.

Run `npm run lint && npm run build`, then cut the release (above).

### First-time submission

1. Cut the release.
2. Fork [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases), append to `community-plugins.json`:
   ```json
   { "id": "clew", "name": "Clew", "author": "Christian Luger", "description": "...", "repo": "christian-luger-at/obsidian-clew" }
   ```
   (`repo` is `user/repo`, not a full URL. Don't reorder existing entries.)
3. Open a PR, fill in the template.
4. An automated bot validates the repo/release; a maintainer then reviews manually (can take days to weeks).
5. Once merged, the plugin appears in **Settings → Community plugins → Browse**.

### Ongoing updates (after acceptance)

No further PR ever needed - bump `manifest.json`/`versions.json`, cut a new release tagged with the exact version, Obsidian clients pick it up automatically.

> [!important]
> The plugin `id` is permanent once accepted - changing it breaks users' saved settings and the update path.

## Additional resources

- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Obsidian API Docs](https://docs.obsidian.md)
- [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Submit your plugin (official guide)](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Community plugins registry](https://github.com/obsidianmd/obsidian-releases)
