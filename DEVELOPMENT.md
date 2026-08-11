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
  settings.ts              # settings interfaces + defaults (the persisted data shape)
  settingsTab.ts           # Obsidian's own Settings screen entry (Settings → Community plugins → Clew)
  graph/
    generateGraph.ts       # deterministic synthetic graph generator (shared by spike/ and scripts/gen-graph-vault.mjs)
    vaultGraph.ts           # builds a graphology graph from vault files + the link graph
    layoutRunner.ts         # thin wrapper around graphology-layout-forceatlas2's worker-based layout
    renderer.ts             # sigma.js setup, node styling, image-node program
    graphPane.ts             # rendering + find-path UI, composed into the view below
    standaloneGraphView.ts   # the "Clew graph view" - ribbon icon / "Open graph view" command, whole vault
    pathfinding.ts           # Yen's k-shortest-paths, hub-avoidance weighting
    layoutModal.ts           # Layout's option data (its panel now lives in graphPane.ts)
    diagnostics.ts           # orphans / broken links / isolated clusters, backing the Diagnostics panel
    egoGraph.ts              # BFS ego-network, backing the Focus panel
    graphAnalytics.ts        # graphology-metrics wrappers (betweenness, PageRank) + normalizeToUnitRange()
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
| `npm run gen-history-vault` | Generate a ~290-note "world history" vault for screenshots/visual demos - see `scripts/gen-history-vault.mjs`'s own docstring for why this is a separate vault from `gen-test-vault.mjs`, not a replacement. `npm run docs:shots` runs this itself; run it directly only to inspect the vault on its own. |
| `npm run sync-private-vault` | Build, then copy `main.js`/`manifest.json`/`styles.css` into the maintainer's personal vault (`scripts/sync-private-vault.sh`) - a real copy, not a symlink, so that vault only picks up a new build when explicitly re-synced, not mid-edit. Pass a path to target a different vault: `npm run sync-private-vault -- ~/some/other/vault`. |

## Testing

Three layers, each catching a different kind of regression:

### 1. Unit tests (functional correctness)

```bash
npm run test        # single run - also runs as part of `npm run lint` and `npm run build`
npm run test:watch  # interactive, re-runs on change
npm run test:coverage
```

[Vitest](https://vitest.dev). Covers the pure graph-algorithm modules directly
(`pathfinding.ts`, `stagnation.ts`, `diagnostics.ts`, `egoGraph.ts`, `graphAnalytics.ts`), plus `vaultGraph.ts` - the actual
node/edge-construction pipeline, exercised
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

Symlink the plugin's build output into it **file by file**, not the whole
repo the way [step 2](#2-link-the-plugin-to-obsidian-symlink) does for a
personal dev vault - `test-vault` and `spike-vault` both need their own
`data.json` (pinned positions, appearance settings), and a whole-directory
symlink would point both at the exact same file, silently sharing state
between two supposedly-independent QA vaults:

```bash
mkdir -p test-vault/.obsidian/plugins/clew
ln -s "$PWD/main.js" "$PWD/manifest.json" "$PWD/styles.css" test-vault/.obsidian/plugins/clew/
```

Every `npm run build` after that updates both vaults automatically - no
manual copy step. Then open `test-vault` in Obsidian and check:

- **Find path** (route icon) is enabled - `FIND_PATH_ENABLED` in graphPane.ts
  gates the toolbar icon, `togglePathfindingPanel()`'s input panel, and the
  command in main.ts; flip it back to `false` if there's ever again a
  reason to hide the feature without deleting it (pathfinding.ts would stay
  as-is, just unreferenced, same as before it was re-enabled). Its result
  panel now has the same header chrome (title + a single "x" that closes
  it) every other panel here uses - it used to just start straight in with
  a heading-less list.
- **The dialog remembers the last search while a result is showing**: run a
  search, then click the toolbar icon again (or the command) to reopen the
  dialog - "From"/"To"/"Directed" should still show what you just searched
  for, including after a "no path found" result (see lastPathSource's own
  docstring in graphPane.ts for exactly which panel states count as
  "showing"). Close the result (its own "x") or open the panel fresh for
  the first time - the fields should be empty, not stuck on an old search.
- **Find path**, `Topic A - Detail 1` → `Topic B - Detail 1`: should offer a
  route through `Bridge Note` as an alternative to the naive route through
  `Hub` - the hub-avoidance cost model should make the Bridge Note route rank
  competitively despite `Hub` being the shorter hop count. The result panel
  should show "Shortest" first, then up to 3 "Alt N" pills next to it in one
  row - 4 total (`MAX_PATH_ROUTES` in graphPane.ts, not pathfinding.ts's own
  library default of 5 - a UI decision, not the library's own) - user
  feedback: 4 full-width rows just to pick a route cost more space than the
  choice itself needed, one row of small pills reads the same choice in a
  fraction of the height. No hover tooltip on a pill either (an earlier
  version showed its note count that way - removed on user feedback); the
  currently-selected pill gets a solid accent fill (same "selected"
  language as the toolbar's own `is-active` icons), and a `Shortest · 3
  notes`-style summary line under the pills always names the one currently
  showing, which is where the note count still lives. **Only "Shortest" is
  drawn on the graph at first** - click "Alt 1" (or 2, or 3): its pill
  becomes the filled one, the summary line and the note list below switch
  to that route's notes, and the graph highlight moves to *only* that route
  - the previously-shown route (and every other route not currently
  selected) should now look exactly like "not on this path at all" (dimmed,
  no distinct color of its own) - user feedback: showing every route
  highlighted at once, each in
  its own color, was hard to read. Clicking a note in the list (under the
  routes) opens it, same as before. **No "Export path to canvas" any
  more** - removed (user feedback, "Warum brauche ich Export Feature?"):
  the auto-generated canvas was just a plain left-to-right chain with no
  real advantage over building one by hand, and the actual "explore this
  path further" need was already covered by clicking a note in the list to
  open it - canvasExport.ts is deleted, not just unreferenced.
  **No legend** - user feedback ("Legende kann weg"): a route's own
  accent-bordered row plus the graph highlight already say which one is
  shown, without a legend repeating it (renderLegend() itself stays, now a
  no-op for this panel, in case a future mode wants a legend entry again).
  **The note list is a vertical stepper** (user feedback: "Stepper mit
  Verbindungslinie", replacing a plain `1. 2. 3.` numbered list) - a marker
  dot per note with a connecting line down to the next one, no link count
  next to it any more (an earlier version showed one - removed on user
  feedback, the dot's own size already carries that signal without a
  number repeating it). `Hub`'s dot should visibly be the largest in the
  list (12 links in the test vault vs. 1-3 for the others on a typical
  route) - `pathStepMarkerSize()` in graphPane.ts grows it the same way a
  node's own size on the canvas grows by degree, so a hub note stands out
  here too, not just on the graph itself.
  **The toolbar icon lights up while a result is showing** - run a search;
  the route icon itself (not just the panel) should get the same solid
  accent fill every other active toolbar icon gets, and lose it again once
  the result is closed. It never did this at all before (a real bug, not
  just a stale state one): `findPathButton` was a local variable inside the
  constructor, with nothing anywhere ever touching its `is-active` class.
- **Find path**, anything → `Island X` or `Island Y`: should report "no path
  found" (a first-class result, not an error, still inside the same header
  chrome) - `Island X`/`Island Y` are a deliberately disconnected two-note
  component.
- **Find path closes Filter/Color & size/Appearance, and vice versa**
  (closeOtherPanels()) - open Filter or Color & size, then run a Find-path
  search: the Filter/Color & size panel should close and its own coloring/
  filtering should stop being visible (Find-path overrides it outright, see
  applyHighlight()'s reducers) - previously it didn't, leaving a stale
  panel open showing criteria that no longer matched what was drawn.
  Conversely, with a path result showing, opening Filter/Color & size/
  Appearance should close the path result panel and clear its highlight.
- **Focus** (crosshair icon, `egoGraph.ts`'s `computeEgoSubgraph()`) -
  GitHub backlog item 3, "Lokaler/Ego-Graph-Modus". No "Apply"/"Update"
  button (user feedback: "Update Focus button not needed. If Note or Hops
  change, the graph is refreshed") and no separate "Clear focus" button
  either (user feedback: "Clear button kann auch weggelassen werden") -
  picking `Hub` as the note (Hops still at its default, 1) should apply
  immediately: only `Hub` and its direct neighbors remain visible,
  everything else hidden, and the panel should switch to showing "Showing
  N notes." Raise Hops to 2 (no extra click) - more notes should appear
  right away (whatever's two hops out), the note count updating to match.
  Click the panel's own "x" - the full graph should reappear and the panel
  goes back to a blank picker form (closing is the only way to clear a
  focus, same as it's the only way to dismiss a Find-path result). Changing
  Hops *before* any note is picked should just be remembered, not error or
  apply anything. **Exclusive, not additive**
  (a decision this backlog item explicitly flagged - "additiv zu
  bestehenden Filtern oder exklusiv?", user chose exclusive): with a
  filter enabled, opening Focus and applying it should override the
  filter's own hiding outright (same as Find-path does) - the filter stays
  "on" in Filter's own panel, it just stops being what's visually applied.
  Conversely, editing a filter (or running a Find-path search, or opening
  Diagnostics' cluster highlight) while Focus is showing something should
  clear Focus and its own hiding, not leave a stale ego-set applied
  underneath whatever just took over. A vault refresh (a note
  created/edited/deleted) or a theme switch should also drop Focus back to
  a blank picker, same as it does for Find-path's result.
- **Dialog zones, round 2** (user feedback: first "keine einheitliche
  Darstellung von Dialogen [...] mal zentral, mal rechts oben, mal rechts
  unter der Navigation", then - once Layout and Find-path's input still
  stood out as native Obsidian Modals - "'Find path' und 'Layout' sind
  immer noch Dialoge, die anders aussehen [...] Navigation oben links [...]
  alle Dialoge [...] links oben unter der Navigation"). One zone now, not
  two: every dialog this view has - Filter, Color & size, Appearance,
  Layout, Find-path's input form, Find-path's result, Diagnostics - is a
  `.clew-filter-panel` child of `.clew-topbar` (top-left, below the icon
  rail). Layout and Find-path's input form used to each be their own
  Obsidian `Modal` (centered, Obsidian's own chrome) - open both from the
  toolbar and confirm they now render as the same box, in the same
  top-left slot, as Filter/Color & size/Appearance/Diagnostics, not
  centered on screen. Legend (bottom-left, passive) and Timeline
  (bottom-center, a scrubber bar) stay outside the zone, unchanged. Every
  panel is still mutually exclusive exactly as before (`closeOtherPanels()`)
  - this only ever changes *where* the open one renders, never *whether* a
  second one can be open alongside it (it still can't). `RadialLayoutModal`
  and the delete-confirmation `ConfirmModal` are the two remaining native
  Modals - deliberately left as Modals (simple, one-shot "pick one thing
  and confirm" dialogs, not asked about either round).
- **Diagnostics** (stethoscope icon): four read-only, always-fresh lists -
  `diagnostics.ts` computes three of them purely from the current graph, no
  saved state of its own; Structural deviation (below) is the one exception,
  computed in `graphPane.ts` itself since it also needs Louvain community
  detection (`stagnation.ts`), not just the graph. Open the panel and check:
  - **Orphans** should list `Isolated` (degree 0) and nothing else from the
    main cluster - `Island X`/`Island Y` do NOT belong here, they have a
    link to each other (see "Isolated clusters" below).
  - **Broken links** should list `Hub → Nonexistent Note` and `Topic C →
    Draft Idea` - the two deliberately unresolved links `gen-test-vault.mjs`
    seeds for exactly this check.
  - **Isolated clusters** should list one row, "2 notes" - the vault's main
    body (`Hub` and everything reachable from it) is deliberately excluded
    (it's what everything else is "isolated" *from*, see
    `findIsolatedClusters()`'s docstring), and `Isolated` itself doesn't
    reappear here either (a size-1 component - already covered by Orphans
    above). No member list is shown here (user feedback: a cluster's note
    list can get long and unwieldy) - click the highlighter icon instead
    (user feedback: replaced the earlier "Show in graph"/"Clear highlight"
    text buttons with an icon pair - `renderHighlightToggleButton()`,
    shared by this section and Structural deviation below; a first icon
    attempt, eye/eye-off, was itself user feedback'd as "passen nicht 100%"
    - a visibility metaphor that didn't quite fit, since a row's notes
    aren't hidden when inactive, just not specially marked):
    `Island X`/`Island Y` should highlight on the canvas (same visual
    treatment as a Find-path route), everything else dims, and the icon
    switches to an eraser (hover tooltip: "Clear highlight"). Click it
    again (or close the Diagnostics panel, or open Filter/Color &
    size/Appearance/Find-path) to clear the highlight.
  - **Structural deviation** (GitHub issue #5, "Stagnation-Cluster gegen
    Ordner-/Tag-Struktur vergleichen") should list exactly one row: "8 notes
    across 5 folders (most in Notes: 3/8)" - the `Scattered *` notes
    `gen-test-vault.mjs` seeds for exactly this check, densely linked to
    each other (so Louvain groups them as one community, confirmed
    separately against a `detectCommunities()`/`communityHomogeneity()` run
    over the same link/folder data while building this feature) but spread
    across `Notes`/`Areas/Work`/`Areas/Personal`/`Archive`/`Inbox`. No other
    row should appear - every other community here (`Old Cluster A/B/C`,
    `Medium Age A/B`, `Topic A`/its details, etc.) lives entirely in one
    folder already, so its homogeneity is 1.0. Same "count + highlighter/
    eraser toggle, no member list" shape as Isolated clusters, and the same
    highlight mechanism/mutual exclusion - but its own separate index
    (`highlightedDeviationIndex`), so having an Isolated-clusters row
    highlighted and then highlighting a Structural-deviation row (or vice
    versa) should swap which one is shown, not show both or get confused
    about which row's icon reads eraser (still active).
  - Clicking an Orphans/Broken links entry should open that note - same as
    Find-path's result list. A highlighted cluster's/deviated community's
    notes are clickable directly on the graph instead (same as everywhere
    else).
  - Opening Diagnostics while Filter/Color & size/Appearance/Find-path is
    open should close the other one (`closeOtherPanels()`), same mutual
    exclusion as every other panel.
  - **Pagination** (user feedback: "u.U. viele Daten anzeigt werden
    müssen" - a vault with hundreds of orphans shouldn't render hundreds
    of `<li>`s unprompted; a later round explicitly dropped a search box
    that an earlier version had - "wenn jemand alles [...] fixen will,
    muss er alle Einträge sehen", so a search that narrows the list isn't
    what someone working through the whole thing wants): the QA vault
    (`gen-test-vault.mjs`) is too small to trigger this on its own
    (`DIAGNOSTICS_PAGE_SIZE` is 20) - temporarily lower it in `graphPane.ts`
    to check by hand, or add a batch of throwaway orphan notes to
    `gen-test-vault.mjs`'s `notes` array. What to verify once triggered: a
    "+ N more" row appears once a list exceeds `DIAGNOSTICS_PAGE_SIZE`, and
    clicking it reveals the next page without losing what's already shown.
  - **Per-section on/off** (Obsidian's own Settings → Community plugins →
    Clew, not a graph-view panel - see `settingsTab.ts`): all four toggles
    default on. Turn "Broken links" off (user feedback: not everyone
    considers unresolved links a problem - some deliberately link to notes
    they haven't written yet) - the Broken links heading/list should
    disappear from the Diagnostics panel the next time it's opened
    (`renderDiagnosticsPanel()` reads the setting fresh each render, no
    reload needed), `findBrokenLinks()` shouldn't even be called while it's
    off. Turn "Structural deviation" off too - its own Louvain pass
    (`computeStructuralDeviations()`) shouldn't run either. Turn all four
    off - the panel should show a single explanatory line instead of an
    empty shell.
- **Ghost nodes** (feature-list item "Ghost-Nodes für nicht-existente
  Notizen", backlog item 16 "Nicht-existente Links", `vaultGraph.ts`'s
  `addGhostNodes()`): this feature is now behind its own Appearance toggle
  ("Show as nodes" → "Non-existent links", right at the top of the panel,
  above "Nodes"/"Edges" - `false` by default) - it used to run
  unconditionally with no way to turn it off at all. **First confirm the
  off state**: on a fresh vault/settings, open the graph - neither
  `Nonexistent Note` nor `Draft Idea` (`Hub`'s/`Topic C`'s broken links)
  should appear as nodes at all (they still show in the Diagnostics panel's
  "Broken links" list either way - that list doesn't depend on this
  toggle). Turn the toggle on - the graph should visibly rebuild (a fresh
  ForceAtlas2 settle, not just a repaint) and both should now appear. Turn
  it back off - they should disappear again. With it on: `Hub`'s and
  `Topic C`'s broken links should each render as their own node directly in
  the graph, not just in the Diagnostics list - **same size** as a real
  note with the same link count (`sizeNodesByDegree()`
  applies the exact same degree-based formula to both; an earlier version
  fixed ghost nodes at a smaller flat size instead, user feedback: "stimmt
  nicht, soll gleich gross wie normale Knoten sein"), distinguished only by
  color and label - a legible muted gray (theme.ts's `ghostNodeColor`,
  contrast-checked against the canvas background the same way `graphColor`
  is), but still clearly visible - **not** `dimNodeColor`, which a first
  version of this used by mistake: that color is blended most of the way
  toward the background on purpose, fine for briefly de-emphasizing
  something during a hover/highlight, but it made a ghost node nearly
  disappear into the canvas as a permanent default (user report: "Die
  Kante ist da. Der Knoten wird aber nicht angezeigt"). Check:
  - Clicking a ghost node does nothing (no note to open).
  - Hovering `Hub` or `Topic C` highlights its ghost neighbor the same way
    it highlights a real linked note.
  - Enabling a Filter, or a Color & size group, with **no** `Node type`
    criterion should make both ghost nodes disappear (Filter) or leave them
    their default gray (Color & size) along with everything else that
    doesn't match - `matchesCriterionValue()`'s own guard (nodeGroups.ts)
    makes every criterion *except* `Node type` a hard non-match for a ghost
    node, even one whose default facts (mtime 0, its real degree, ...)
    would otherwise coincidentally satisfy it (a `staleDays`/`minLinks`
    criterion, for example).
  - Neither ghost node should appear in the Diagnostics panel's Orphans
    count, and the "Isolated clusters" count should reflect real notes
    only (a cluster containing a ghost node should not be inflated by it).
  - **Node type criterion** ("+ add" menu → "Node type (note/tag/
    attachment/nonexistent link)", available in both Filter and Color &
    size - same shared criterion system, see `nodeGroups.ts`'s
    `CriteriaOwner`): a single unified four-way criterion, replacing the
    earlier separate `Existence` (real vs. ghost) and `Node type` (tag vs.
    attachment) criteria - user feedback: "Node type muss 4 Werte haben
    [...] Das Auswahlkriterium 'Existence' ist dann nicht mehr notwendig".
    Set to "Nonexistent link" in a Filter - only `Nonexistent Note` and
    `Draft Idea` should remain visible, everything else (including `Hub`/
    `Topic C` themselves) hidden. Set to "Normal note" instead - the
    inverse. In Color & size, a group with this criterion set to
    "Nonexistent link" plus a chosen color/size multiplier should repaint
    both ghost nodes with that color/size instead of the default gray/
    small - same mechanism as any other group, just targeting ghost nodes
    specifically.
  - **Default filters/color groups** (`filter.ts`'s `DEFAULT_FILTER_PRESETS`,
    `nodeGroups.ts`'s `DEFAULT_NODE_GROUPS` - fixed `id`s, added/removed by
    `main.ts`'s `syncDefaultPresets()`): on a fresh install (or the QA
    vault's own `data.json`, if any, deleted), the Filter panel should
    already list "Non-existent links", "Attachments", and "Tags" (all
    unchecked), and Color & size should already list the same three names
    (orange/blue/violet, also unchecked) - all six ready to enable, not
    needing "+ add" → "Node type" from scratch. (An earlier round also
    shipped a "Show existing notes" default filter - user feedback: "Filter
    'Show existing notes' löschen" - removed entirely, not replaced.) In
    Settings → Community plugins → Clew, turn "Default filters" off - all
    three filter rows should disappear from the Filter panel the next time
    it's opened (even mid-session, no reload needed -
    `syncDefaultPresets()` runs immediately on toggle). Turn it back on -
    they reappear, freshly reset (any rename you made is gone - toggling
    off is what removes them, not a private "hidden but remembered" state).
    Same check for "Default color groups" against the three colored groups.
    Enabling "Non-existent links" should behave exactly like a user-built
    `nodeKind: 'nonexistent'` filter - because it is one.
  - **Not deletable or editable from the panel** (user feedback: "diese
    Einträge dürfen vom Benutzer nicht gelöscht werden [...] und auch
    nicht editierbar"): every default row should show **neither** a
    pencil (edit) **nor** a trash icon in both the Filter and Color & size
    panel, unlike every user-created filter/group -
    `isDefaultFilterId()`/`isDefaultGroupId()` in `graphPane.ts` skip
    rendering both specifically for these fixed `id`s. The row's own
    enabled checkbox is untouched, still there and still live - a default
    filter/group can be turned on/off exactly like any other, it just can't
    be renamed, recolored, have its criteria changed, or be deleted. The
    only way to remove one at all is the Settings-tab toggles (checked
    above).
- **Tag nodes** (backlog item 11, "Tags als Knoten", `vaultGraph.ts`'s
  `addTagNodes()`): Appearance → "Show as nodes" → "Tags" (`false` by
  default, independent of the other two switches here). Off: no tag nodes
  in the graph at all. On: `#project` should appear as its own node with
  edges to `Topic A`/`Topic A - Detail 1`/`Topic A - Detail 2` (all three
  carry it) and **not** to `Topic B`/`Topic C` (no tags there, even though
  they're already linked to `Topic A` via `Hub`) - the point of this
  feature is a *second*, independent kind of structure becoming visible,
  not a restatement of the link graph. `#urgent` should appear as its own
  separate node linking only `Topic A - Detail 2`. Click a tag node - does
  nothing (no file behind it, same as a ghost node). Hovering `Topic A -
  Detail 2` should highlight both its tag neighbors like any other link.
  **Default color**: with no Color & size group enabled, `#project`/
  `#urgent` should render in the plain node color (`resolvedNodeColor()`),
  the same as any real note - not a special tag color. An earlier version
  gave tag nodes their own always-on `theme.ts` color (reading Obsidian's
  `--graph-node-tag`, which resolves to green in the default theme) - user
  feedback: "Tags-Knoten werden immer grün dargestellt, obwohl kein
  Color&Size gesetzt ist. Diese sollten in der normalen Knotenfarbe sein" -
  removed; enable the "Tags" default color group (or build a `nodeKind:
  'tag'` group yourself) to color them on purpose.
  **`Node type` criterion** ("+ add" → "Node type", set to "Tag node"):
  should match `#project`/`#urgent` and nothing else - not even a
  `Nonexistent Note` ghost node, despite both having `exists: false`
  internally (`nodeGroups.ts`'s `matchesCriterionValue()` guard exempts
  `nodeKind` from the exists-check entirely, but each of its four values
  still only matches its own kind). Toggling "Tags" off again should make
  the tag nodes disappear and, if a `nodeKind: 'tag'` filter/group was
  enabled, leave it matching nothing (not erroring).
- **Attachment nodes** (backlog item 15, "Attachments als Knoten",
  `vaultGraph.ts`'s `addAttachmentNodes()`): Appearance → "Show as nodes" →
  "Attachments" (`false` by default). On: `diagram.svg` should appear as
  its own leaf node with one edge to `Bridge Note` (the note that embeds
  it via `![[attachments/diagram.svg]]`) - distinct from `With Cover`'s
  existing cover-image mechanism (frontmatter `cover:`, a different code
  path entirely, unaffected by this toggle either way - `With Cover` should
  keep rendering its cover image regardless of whether "Attachments" is on
  or off). Unlike a tag/ghost node, clicking `diagram.svg` **should** open
  it (a real file at a real vault path - Obsidian previews an image/PDF the
  same as it would from clicking it in the file explorer). `nodeKind`
  criterion set to "Attachment node" should match only `diagram.svg`.
  **Default color**: with no Color & size group enabled, `diagram.svg`
  should render in the plain node color, not `imageNodeColor` - same fix,
  same user feedback, as tag nodes above ("Das selbe gilt für Attachments.
  Diese haben per Default auch nicht die normale Knotenfarbe"). `With
  Cover`'s own cover-image note is unaffected either way - that's a
  distinct mechanism (`attr.type === 'image'`, a real note, not
  `kind: 'attachment'`) that still defaults to `imageNodeColor`.
- **Cluster freshness** (an "Activity" criterion on a node group - see
  "Color & size" below and `nodeGroups.ts`): create a group with a single
  Activity criterion, reading "Notes in [an inactive area of the vault]" -
  `Old Cluster A/B/C` (backdated ~200 days) should join the group; `Medium
  Age A/B` (~45 days) and everything fresher should not, since they're in
  the fresher half of clusters present. Switch the dropdown to "an active
  area of the vault" - now the fresher clusters should join instead and the
  old ones should drop out. This is a plain two-way choice (a note's
  cluster is in the stalest half present, or the freshest half - see
  `StalenessBucket` in `nodeGroups.ts`), not a numeric threshold - two
  earlier attempts (a raw 0-1 ratio, then a labeled 0-100% range) were both
  user feedback'd as still not understandable. Renamed from "Stagnation" to
  "Activity", and reworded "in the [Most stagnant] half of clusters" to
  "Notes in [an inactive area of the vault]", in a later round - user
  feedback: even the binary version was still not understandable, not
  because a two-way choice is inherently confusing but because of
  "cluster"/"half" jargon with no obvious vault-editing meaning. Hover the
  "Activity" heading (while a criterion of this type is expanded) - a
  tooltip should explain the underlying mechanism (neighborhoods of
  tightly-linked notes, compared by overall recency) in one sentence,
  rather than a permanent line of text under the heading (every other
  criterion type manages without one).
- **Structural deviation** (a "Structure" criterion on a node group/filter -
  GitHub issue #5, see `nodeGroups.ts`): create a group with a single
  Structure criterion, "Notes whose linked neighborhood is [Scattered across
  folders]" - only the 8 `Scattered *` notes should join the group (same
  community Diagnostics' own "Structural deviation" section lists - see
  above); everything else (including the mono-folder `Old Cluster A/B/C`/
  `Medium Age A/B` communities) should not. Switch the dropdown to "Gathered
  in one folder" - the opposite should happen: `Scattered *` drops out,
  every other note whose community *is* mono-folder joins instead (`Isolated`
  included - Louvain still gives it its own single-note "community", which
  trivially has homogeneity 1.0, same precedent as `clusterFreshness` below
  being able to match it too). Hover the "Structure" heading (while a
  criterion of this type is expanded) - a tooltip should explain the
  underlying mechanism (neighborhoods of tightly-linked notes, compared
  against the vault's own folders) in one sentence, same treatment as
  "Activity"'s own tooltip below.
- **Graph-Analytics erweitern** (GitHub backlog item 5 - Bridging/
  Prominence/Connectivity/Community, four new node-group/filter criteria;
  `graphAnalytics.ts` wraps the new `graphology-metrics` dependency):
  - **Bridging** (betweenness centrality): create a group with "Bridging is
    [High (a bridge note)]" - `Bridge Note` and `Hub` (both sit on real
    shortest paths between otherwise-separate parts of the vault) should
    join; leaf notes with only one link (`Topic A - Detail 1`, etc.)
    should not. Hover the "Bridging" heading for its tooltip.
  - **Prominence** (PageRank): "Prominence is [High (prominent)]" - `Hub`
    (linked from the most, and most-varied, other notes) should join;
    `Isolated`/`Island X`/`Island Y` (no or few links) should not.
  - **Connectivity** (`isolatedComponent`, backed by the same
    `findConnectedComponents()` the Diagnostics panel's own "Isolated
    clusters" section uses): "In an isolated part of the vault" should
    match `Isolated`, `Island X`, `Island Y`, and every `Scattered *`/`Old
    Cluster`/`Medium Age` note *if* Louvain still lands them outside the
    main body (check against what's actually connected to `Hub` in the
    current vault) - "In the vault's main body" should match the inverse
    set exactly.
  - **Community**: create a group with "Community is [1]" (1-based in the
    UI, 0 = the largest community internally - see
    `rankCommunitiesBySize()`) - picking a note's own community number
    should color that whole neighborhood, and *only* that one. Add the
    criterion via "+ Add" → "Community" and confirm the group's color
    picker immediately jumps to `communityColor(0)`'s fixed palette entry
    (`nodeGroups.ts`'s `DEFAULT_GROUP_COLORS[0]`, red) without touching the
    color picker yourself; change the number field - the color should
    update to match the new community's own palette entry live, every
    time, not just once. This is "Community-Färbung mit fester Palette" -
    entirely through the existing chip system (`CriteriaEditorContext.
    onCommunityColorSync`), no separate coloring UI.
  - **Only pay for what's active**: with no enabled group/filter using any
    of the four, none of `computeBetweenness()`/`computePageRank()`/
    `findConnectedComponents()`/`detectCommunities()` should run at all
    (check via a temporary `console.log`/breakpoint in `graphAnalytics.ts`/
    `buildCriteriaFacts()` if in doubt) - each has its own `needsX()` gate,
    same pattern as `needsClusterFreshness()`. With *both* `clusterFreshness`
    and `community` enabled at once, Louvain should still only run once per
    `buildCriteriaFacts()` call, not twice - the two share one
    `detectCommunities()` result (see `buildCriteriaFacts()`'s own
    docstring).
- **`With Cover`** should render its frontmatter `cover` image as the node,
  not a plain dot.
- **`Isolated`** (no links at all) should still render with degree 0 and be
  colorable by any group whose criteria it happens to match (e.g. a
  `filename`/`tag`/`property` criterion) - Louvain still assigns it its own
  single-note community, so a `clusterFreshness` criterion can match it too.
- **Timeline** (history icon, opens a compact bottom-center row - Play,
  scrubber, date, duration, an (i) tooltip carrying the ctime-only-
  approximation explanation, Close - see `timeline.ts`'s docstring for
  that approximation and why: Obsidian records no history of when a link
  was actually added, only each file's own `ctime`/`mtime`, same
  limitation as core Obsidian's own Graph View "Animate" toggle. User
  feedback: an earlier version had a header + permanent description
  paragraph + controls, "überdeckt viel wertvolle Fläche" - now a single
  row). **Open it: the scrubber should start at the far left (the oldest
  note), not "today"** - user feedback, matching a video player's own
  convention (starts at 0:00) - and the graph should immediately narrow
  down to just the earliest note(s), not stay showing everything. Drag
  the scrubber right: notes/edges should appear in creation order -
  `test-vault`'s backdated `Old Cluster A/B/C` notes should be the first
  ones to show. **New notes/edges should visibly grow in, not just pop in
  at full size** (user feedback) - drag the scrubber past one and confirm
  it briefly grows from small to full size (~400ms, `TIMELINE_FADE_MS` in
  graphPane.ts) rather than appearing instantly; scrubbing back and forth
  over the same note repeatedly should re-trigger the grow-in each time,
  not just the first. **Playback is paced by distinct creation moments,
  not calendar days** (see `timeline.ts`'s `computeTimelineSteps()`/
  `cursorForElapsed()` docstrings - discovered testing against
  `test-vault` itself: most of its notes share one ctime,
  `gen-test-vault.mjs`'s own run, with only `Old Cluster A/B/C`/`Medium
  Age A/B` backdated - pacing by calendar days spent ~27 of a 30-second
  playthrough crawling through that sparse backdated tail, then revealed
  all 14 same-ctime notes in a single instant, reading as "Play does
  nothing"). Press Play: the duration dropdown ("10s"/"30s"/"1 min"/
  "3 min") is how long the *whole* replay takes, always, regardless of the
  vault's real date spread - `test-vault` has 7 distinct creation moments,
  so at "10s" each is ~1.4s apart, evenly, not weighted by the ~200-day
  gap between the oldest cluster and everything else. Confirm the graph
  visibly changes at roughly even intervals throughout the whole duration,
  not just at the very end. **Pace mode toggle** (the ⚡/📅 icon, user
  feedback: the jump-y date this even pacing produces "kann sehr
  verwirrend sein" for some vaults - see `timeline.ts`'s
  `TimelinePaceMode` docstring): click it mid-playthrough - the graph
  should keep animating continuously through the switch, not jump or
  restart. In "real calendar time" mode, confirm playback instead spends
  time proportional to each gap - `test-vault`'s ~200-day span should
  crawl through the ~185-day gap before `Medium Age A/B` slowly, then
  reveal the 14 same-ctime notes in a near-instant burst at the very end
  (the exact behavior "steps" mode was built to avoid - both are
  legitimate depending on what the vault's own date spread looks like).
  Pause and resume mid-playthrough (in either mode) - should continue
  from the same position, not jump. **Persistence** (user feedback -
  settings.ts's `ClewTimelineSettings`, not session-only state): default
  pace mode is "Real time"; change the duration and pace-mode dropdowns,
  reload the plugin (or restart Obsidian) - reopening the Timeline panel
  should show the picks you left, not the defaults. The scrubber's own
  position is *not* persisted - it always starts at the beginning on open
  (see toggleTimelinePanel()'s docstring), by design. **Toolbar icon
  highlight**: open the panel (icon should highlight) and let a
  playthrough finish (cursor back at "today") - the icon should *stay*
  highlighted the whole time the panel is open, not lose its highlight
  once nothing is actually being filtered anymore (a real bug this exact
  scenario caught - see updateTimelineButtonState()'s docstring). **A
  vault where every note
  shares one ctime** (a single distinct creation moment): the Play button
  and scrubber should be disabled with an explanatory note ("Every note
  here was created at essentially the same time") rather than a Play
  button that silently does nothing - construct one by touching every
  file in a fresh vault at once (e.g. `touch` from a shell), not via
  `gen-test-vault.mjs` (which always backdates a few notes).
  **Combines with an active Filter** (user feedback - `currentFilterMatches()`
  is shared by applyFilter()/applyTimeline(), an earlier version had the
  timeline silently override the filter entirely instead): enable a
  filter first, then scrub the timeline - only notes matching *both* the
  filter and the current ctime cutoff should show, not everything up to
  that cutoff. Edit or toggle the filter while the timeline is mid-scrub
  (not resting at "today") - the graph should immediately reflect the new
  filter intersected with the current cursor position, not silently drop
  back to an unfiltered timeline view. Scrub all the way right to "today"
  (or close the panel, which snaps the cursor there directly) - the
  original filter should resume controlling visibility on its own. Still
  mutually exclusive with Find path/Stagnation, which override each other
  the same way they always have. **Vault refresh mid-playback**: start
  playback, then create a new note - playback should stop (not animate against a
  now-stale file set) and the slider's range should silently extend to
  cover the new note's `ctime` next time the panel is reopened.
- **Filter** (funnel icon, opens a panel that drops down directly below the
  icon rail - not positioned like "Appearance…", with its own "x" to
  close): same create/edit/delete/enable list architecture as "Color &
  size" (see `filter.ts`'s docstring for why - user feedback: "es fehlt
  die gesamte Logik für erstellen/editieren/löschen von Filtern (wie in
  Color & Size)") - "+ new filter" creates a named, immediately-enabled,
  empty-criteria `FilterPreset` and opens it in edit mode; its row shows
  the same drag handle + name + edit (pencil)/delete (trash) + enable
  toggle as a Color & size group's row, minus the color swatch (a filter
  has no color). **Drag to reorder** (user feedback: "Drag & Drop in
  Liste fehlt"): drag a filter row above/below another - the list order
  should persist (reload the plugin/restart Obsidian to confirm), but
  since several enabled filters combine per "Combine filters" (see below),
  not by their own order, reordering must have *no effect* on which notes
  are shown - unlike a node group's own drag-to-reorder, which does
  control color precedence. Its edit form is flattened the same way as
  Color & size's own (user feedback that the flattening should apply here
  too, not just there - see `.clew-group-edit-flat` in `styles.css`): no
  "Filter"/"Criteria" Setting headings any more, just a name field (no
  color swatch - a filter has none, and no "..." menu either - there's no
  filter-level option like "Scale size" to hide behind one) with the
  closing "x" at the row's right end, then the exact same "Criteria" chip
  list + "+ add" menu Color & size uses directly beneath it (including
  `Not edited at least (days)`/`Minimum number of links`/`Activity`, not
  just the original text/tag/property set, and the same one-chip-per-line
  layout with an accent-border edit row, not a boxed one - see Color &
  size's own entry above), always AND'd within one filter (same as a node
  group's own criteria - no per-filter AND/OR choice, see below for why
  that choice lives one level up instead).
  **"Show if it matches": At least one filter vs. Every filter**
  (a panel-level dropdown, above the filter list, not per-filter - user
  feedback: "Das ist auf der falschen Ebene [...] soll für die Kombination
  von ganzen Filtern gelten", after an earlier version put an AND/OR
  choice on each filter's own criteria instead, one level too low - and a
  later wording pass, "Combine filters"/"Any enabled filter"/"All enabled
  filters", still didn't read well): create two filters whose criteria no
  single note satisfies both of (e.g. one filters on a `Tag` no note has,
  the other on a `Filename` every note matches), enable both - with "At
  least one filter" (the default) both filters' matches show (OR); switch
  to "Every filter" - now nothing shows, since no note matches *both*
  filters (AND). Disabling one filter with "Every filter" selected should
  make the graph reflect just the remaining enabled filter (an AND across
  a *single* enabled
  filter is a no-op). Deleting a filter (with a confirm dialog, same as
  deleting a node group) should immediately stop it affecting the graph
  either way. **No legend entry**
  (user feedback: "Legende weg") - a filter's own name/chips are already
  the label, same reasoning node groups already have for skipping the
  legend. **Persistence**: set up a filter, close the panel (the "x" or
  the filter icon again) - the filter icon should stay highlighted
  whenever any filter is enabled; reopen the panel - the filter list
  should still be there. Reload the plugin (or restart Obsidian) - enabled
  filters should still apply (see settings.ts's ClewSettings.filterPresets
  - saved, not just session state). Opening "Find path", or enabling/
  editing a node group in "Color & size…", should *not* clear saved
  filters - they're a baseline the path/group reducer temporarily paints
  over. **Hover while filtering**: with a filter active, hover a *visible*
  (matching) node - every currently-hidden node/edge must stay hidden
  throughout the hover, not flash back into view (a real bug this exact
  scenario caught: the hover reducer's "everyone else" branch was reading
  raw graph attributes instead of the filter's own reducer output,
  silently dropping `hidden`). **Only one dialog at a time** (user
  feedback: "immer nur einen Dialog anzeigen" - reversing an earlier
  decision that let Filter/Color & size/Appearance stack in their own
  corners): opening "Appearance…" while the Filter panel is open should
  close Filter (and vice versa, and same for Color & size against either
  of the other two) - see `closeOtherPanels()` in graphPane.ts. Any
  criterion/group being edited when its panel closes this way should
  collapse cleanly (no leftover edit-mode state) the next time that panel
  reopens. **Enabling a `text` filter after a content-
  independent Color & size criterion** (a real bug this exact scenario
  caught): with only a `clusterFreshness`/`folder`/`tag`/etc. group active
  (nothing needing `noteContentCache`), create a *disabled* filter with a
  `text` criterion, then flip its enable toggle on - it must find matches
  immediately, not stay permanently empty. The toggle's handler used to
  call `applyFilter()` directly instead of `applyFilters()` (which also
  triggers `refreshCriteriaContent()`), so enabling it never checked
  whether `noteContentCache` (still empty, since nothing had needed it
  yet) needed populating - the `text` criterion matched zero notes forever
  until some unrelated criteria edit happened to trigger a refresh.
- **Empty state** (`showEmptyState()`/`updateEmptyState()` in graphPane.ts
  - user feedback: an empty canvas with no explanation reads as broken):
  a centered card, same floating-panel look as Filter/Legend, distinguishes
  *why* nothing's shown. Open the graph on an empty vault (or temporarily
  rename `test-vault`'s notes out of it) - "No notes in this vault" with a
  file icon, no button (nothing actionable from inside the graph view).
  With notes present, enable a filter whose criteria match nothing (e.g. a
  `Filename` criterion for a string no note has) - "No notes found" with a
  search-x icon and a "Reset filter" button; clicking it should disable
  every enabled filter and bring the graph back. The vault-empty check
  takes priority - if `this.files.length === 0`, that card shows even
  with a filter also configured. Toggling a group in "Color & size…" alone
  should never show this card - only Filter can hide *every* node (Color &
  size only recolors, per its own docstring).
- **Deterministic layout**: close and reopen the graph view (or reload the
  plugin) a few times - each note should *start* the force layout from the
  same position every time, so the settled result looks recognizably the
  same rather than a fresh scatter on every open. Not pixel-exact (FA2's
  Worker runs for a fixed wall-clock budget, not a fixed iteration count -
  see `vaultGraph.ts`'s `deterministicPosition` docstring for why only the
  starting positions, not the physics run itself, are seeded), but the
  overall arrangement and which notes end up near each other should be
  stable.
- **Switching to Force layout** (from Hierarchical/Radial/Circular, or
  reopening the graph view): the camera should visibly track the graph as
  it spreads out from its tight deterministic seed over the ~2s settle,
  not stay frozen at the *previous* layout's framing until a single jump
  at the very end (a real bug this exact scenario caught - user feedback:
  "die Anzeige ist zuerst sehr klein und braucht 2 sec, um die richtige
  Grösse zu haben" - `setForceLayout()` used to fit the camera only once,
  in `onSettled`, so the previous layout's zoom stayed on screen for the
  entire settle while nodes visibly grew underneath it). Should read as a
  smooth zoom-out, not a stutter or a flash of the wrong framing.
- **Layout selection** (`renderLayoutPanel()` in graphPane.ts, options
  data in `layoutModal.ts`): a single "Layout: Force" toolbar button (its
  own tooltip always shows the current mode) opens a panel - not a dropdown
  menu (user feedback: picking a layout should come with an
  explanation of what each one is actually for, not just a bare name), and
  not a per-row "Active"/"Use" button either (user feedback that felt off:
  a tiny click target at the row's edge, disconnected from the name/
  description that's the actual reason to pick it, plus a disabled
  "Active" button that read as broken) - each of the four options is one
  whole clickable row: hover highlights it, the active one gets an accent
  border/background and a checkmark (not a disabled button), every other
  enabled row shows a plain chevron. Click anywhere on the "Hierarchical"
  row - the dialog should close and `Hub` and its linked notes should
  arrange top-to-bottom by link direction instead of the force-directed
  scatter (briefly shows "Computing…" first, see `hierarchicalLayout.ts`
  for why this is synchronous rather than instant). Reopen the dialog -
  "Hierarchical" should now show the accent border + checkmark; click
  "Force" - should return to the force layout, restarting from the same
  deterministic starting positions as before (not wherever the
  hierarchical layout left the nodes). On a vault with more than
  `HIERARCHICAL_LAYOUT_NODE_LIMIT` (1,000) notes - e.g. `spike-vault` -
  "Hierarchical"'s row should be visibly dimmed, not clickable, and its
  description should get "(Too many notes for this layout.)" appended:
  dagre's layout algorithm doesn't scale to vault-sized graphs (confirmed
  empirically: still incomplete after 60s at 10,000 nodes). **Radial**:
  its row always shows a "Choose note…"/"Choose a different note…" hint
  (not a checkmark, even while it's the active layout) and clicking it
  always opens the existing note-picker dialog (`radialLayoutModal.ts`) -
  that's how you re-center on a different focus note, since picking
  "radial" alone isn't enough information to actually run it (same
  behavior the old menu had for its radial item).
- **Theme-aware colors**: switch Settings → Appearance between light and
  dark, and (if available) a community theme - the graph's colors
  (default node, cover-image node, edges) should follow the switch without
  reloading the plugin, since `theme.ts` reads Obsidian's own documented
  CSS variables (`--color-purple`, `--color-orange`, `--text-faint`, etc.)
  rather than fixed hex values, and `GraphPane.refreshTheme()` re-reads
  them on Obsidian's `'css-change'` workspace event. Also check "Find
  path…" and the cluster-freshness coloring still look reasonable in a
  light theme - never verified there before this.
- **Color & size** (palette icon, opens a panel dropping down below the
  icon rail, same look as Filter/Appearance - see `nodeGroups.ts`): click
  "+ new group" - a blank group ("Group 1", a default color, no criteria)
  is created, saved, and opens directly in its edit form, flattened to a
  single color+name row at the top - no "Group" heading above it any more
  (removed, along with the "Criteria" heading/description below - user
  feedback that the nested headings/boxes read as cluttered before you
  even reach a criterion; see `.clew-group-edit-flat` in `styles.css`).
  Color swatch flush left, title field stretching to fill the row, then a
  "..." (more options - currently just "Scale size", see below) and "x"
  (closes the form back to the group's row) at the right end. Set the name
  to "Status A", click "+ add" - it should sit flush with the name row and
  criteria list above it, at the form's own left edge (an earlier version
  aligned it to the now-removed "Criteria" heading's indent instead - a
  plain div can be aligned by nudging its *content* with padding, but a
  button has its own visible box, so it needed its whole box shifted with
  a margin; both are gone now that there's no heading to align to). It
  opens a small menu (Tag / Property / Folder / Filename / Text /
  Stagnation, the same Menu-based pattern the "Layout" toolbar button used
  before it became its own explanatory dialog) - pick "Property" and the
  new criterion opens directly in its expanded controls (not yet a chip,
  since it still needs configuring), all on **one wrapping row**: a
  "Property" badge, then the key/operator/value controls, then the
  checkmark/"x" pinned to the row's right end via auto margin - the row
  only breaks onto a second line if the fields themselves don't fit
  (previously a fixed heading-then-fields-then-actions stack of up to 4
  lines regardless of how short the criterion was - user feedback); set it
  to `status` / "Equals" / `done` - *without clicking anything else*,
  every note with `status: done` (`Topic A`/`Topic A - Detail 1`/`Topic A
  - Detail 2`) should immediately take that color and the palette icon
  should highlight - **everything here saves immediately as you go, there
  is no separate Save step anywhere in this panel**. Click the checkmark
  next to the criterion - it should collapse into a compact chip reading
  `status equals "done"` (nodeGroups.ts's `describeCriterion()`), sitting
  directly under the name row with no heading above it any more.
  **Cancel reverts, not deletes**: click an existing chip to re-expand it,
  change its value, then click the "x" (not the checkmark) - it should
  revert to what the chip showed *before* you started this edit, not
  delete the criterion (an earlier version deleted it - user feedback:
  "x" while editing should mean Cancel). For a criterion you just added
  via "+ add" (never had a "before" state), the same "x" removes it
  instead, since there's nothing to revert to. A chip's own "x" *while
  collapsed* still removes it directly, no expand needed. **Chips, one per
  line**: with several criteria configured, they should stack one below
  the other, each on its own line, not wrap several onto a shared row
  (changed from an earlier wrapping-row layout - user feedback: several
  chips sharing a line read as a messy cloud of pills rather than a
  scannable list of conditions); each chip still only as wide as its own
  text, not stretched to fill the row. **Editing a criterion has no boxed
  frame**: expand a chip into its full controls - it should show only a
  thin accent-colored line down its left edge, not a solid background
  panel with its own border (an earlier version's full box, sitting inside
  the already-boxed group card, read as "boxes within boxes" and made the
  form feel busy/restless - user feedback, especially visible in dark
  themes). **Wrapped tag pills**: expand a `tag` criterion and pick enough
  tags that its pills wrap onto a second line - the wrapped line should
  stay inside the criterion's own row, and the checkmark/"x" should still
  land at the end of whichever line has room for them (its own trailing
  line if the fields filled the row completely). **No empty-state text**:
  a brand new group with no criteria yet should show no placeholder line
  at all - just the name row and the "+ add" button, nothing in between.
  **Multiple criteria (AND only)**: add a `tag` criterion too - now only
  notes matching *both* the property AND the tag should stay colored
  (every criterion in a group is still AND'd, with no OR/grouping option -
  unchanged, just no longer spelled out in a heading description since
  that heading is gone). **Size multiplier**: open the "..." menu next to
  the name - "Scale size" is off (unchecked) by default on a new group;
  click it on - a "Size multiplier" slider appears directly under the name
  row (no explanatory text under it - its own live tooltip while dragging
  is enough), range 0.3-3, starting at 1; drag it to 2 - matching notes
  should visibly grow, but a hub note among them should still look bigger
  than a leaf note in the same group (it's a *multiplier* on each note's
  own degree-based size, not a fixed size replacing it - user feedback: an
  earlier absolute-size version made every matching note identically
  sized, losing the hub-vs-leaf signal entirely); at exactly 1 every
  matching note's size should be unchanged from default. Open the "..."
  menu again and click "Scale size" off - the slider disappears and sizes
  return to fully default. **Closing a group's edit form**: there is no
  standalone "Done"/Save/Cancel button at the bottom any more (removed -
  user feedback: nothing was left for it to commit) - the only way to
  collapse the form back to the group's row is the small "x" at the right
  end of the name row, next to "...".
  **Precedence**: create a second group ("Status B", a different color,
  the same `status` equals `done` criterion) - only the *first* group in
  the list (topmost) should win for those notes; **drag "Status B" above
  "Status A"** by its grip handle (left end of the row) - dropping on
  another row always moves the dragged group to just before it, and the
  notes should switch to "Status B"'s color, confirming order is the
  precedence rule (drag-and-drop replaced the earlier ↑/↓ arrow buttons -
  user feedback). The dragged row should visibly dim while dragging, and
  the row you're hovering over while dragging should get a top border
  showing where it'll drop. Every group row icon (the grip handle, edit
  pencil, delete trash) should darken (or lighten, in dark mode) clearly on
  hover - Obsidian's own default `.clickable-icon:hover` only adds a very
  subtle background tint and leaves the icon's own color unchanged, which
  user feedback (with a screenshot) called still "kaum sichtbar" even after
  an earlier round's drag-handle-only fix; every `.clickable-icon` in the
  Filter/Color & size panels now also darkens to `--text-normal` on hover,
  not just its background. Separately, an earlier version's ↑/↓ arrows went
  nearly invisible on hover specifically at the top/bottom of the list,
  because a *disabled* button (the arrow with nowhere further to move) gets
  no hover feedback at all in Obsidian's own button styling (just a
  permanently low opacity); removing the disabled boundary case entirely
  (every row is always fully draggable, nothing to disable) fixes
  this structurally rather than patching around it. **Enable toggle**:
  toggling a group's switch off (on its collapsed row, no need to open the
  edit form) should immediately stop it affecting the graph, and drop the
  palette icon's highlight if it was the last enabled group. **Toolbar
  palette icon stays solid on hover**: with at least one group enabled (so
  the palette toolbar icon has its solid `--interactive-accent` fill, white
  icon), hover it - it must stay a solid, high-contrast fill, not fade to a
  barely-visible pale tint. A real CSS specificity bug caused exactly that
  fade (user feedback, with a screenshot, pointing specifically at this
  icon and not the panel's own edit/delete icons - a separate issue from
  the panel-icon fix above): Obsidian's own `.clickable-icon.is-active:hover`
  selector (three classes) is more specific than our
  `.clew-toolbar button.is-active` (two classes plus one element - the
  element doesn't count toward the class tier that decides this), so on
  hover it silently won and swapped the solid fill for
  `--background-modifier-active-hover` (a ~10% accent tint) while the icon
  stayed white - a white icon on a near-white background. Fixed by adding
  a `.clew-toolbar button.is-active:hover` rule that matches Obsidian's own
  three-class specificity instead of just one-upping the non-hover rule.
  **Delete**: should show a confirmation dialog first ("Delete group?" /
  group name in the message) - cancelling it must leave the group
  untouched; confirming should immediately un-color its matched notes
  (falling through to the next matching enabled group, or the default
  color if none). **Max groups**: create groups until "+ new group"
  disables itself at 10 (`MAX_NODE_GROUPS`). **Persistence**: reload the
  plugin (or restart Obsidian) - every saved
  group (including disabled ones) and its enabled/disabled state should
  survive.
- **Color & size criteria - other types**: `folder` - a free-text field
  (not a dropdown - user feedback: a vault can have many folders) with
  autocomplete suggestions via a native datalist; typing a folder path
  should match that folder *and every subfolder under it*, not just notes
  directly in it. `filename` (contains, title only). `tag` - pills + a
  "+ tag…" picker, same widget as the Filter panel's own tags, letting one
  criterion match *any* of several tags at once (user feedback) rather
  than needing a separate row per tag. `text` (contains, matches the
  *title and note body* - create a group with a `text` criterion matching
  a word that only appears in one note's body, not its title, and confirm
  that note joins the group; this reads every note's content once via
  `vault.cachedRead()`, only when at least one enabled group actually has
  a `text` criterion - `needsContentSearch()` in `nodeGroups.ts`).
  `property` - an operator dropdown (Contains / Equals / Not equals / Is
  empty / Is not empty) next to the key; picking "Is empty"/"Is not empty"
  should hide the value field entirely (it's not needed); "Is empty"
  should match notes *missing* the property altogether, not just ones with
  an empty string value. Every criterion row (any type) should render as a
  single compact line with a thin divider between rows, not a full Setting
  block each - the whole criteria list should read as noticeably more
  compact than a typical Settings screen (user feedback: the UI wasn't
  "clean enough").
- **Color & size criteria - staleness/links**: `staleDays` ("Not edited at
  least (days)") and `minLinks` ("Minimum number of links") - same
  mechanism as the Filter panel's own "Not edited in at least (days)" /
  "Minimum number of links" fields (`filter.ts`'s `staleDays`/`minDegree`),
  just as a group criterion instead of a filter. Create a group with a
  `staleDays` criterion of e.g. 30 and confirm only notes whose mtime is
  30+ days old join it; same for `minLinks` against `graph.degree()`.
- **Criterion negation (the clickable include/exclude word)**: `Folder`,
  `Filename`, `Text`, `Tag`, `Not edited`/staleDays, and `Links`/minLinks
  (Color & size *and* Filter, since both share `nodeGroups.ts`'s
  `GroupCriterion`) each show one small clickable word inline in their own
  controls - `is`/`is not` (Folder), `contains`/`does not contain`
  (Filename, Text), `any of`/`none of` (Tag), `At least`/`Less than`
  (staleDays), `At least`/`Fewer than` (minLinks) - see
  `renderNegateWord()` in graphPane.ts. User feedback: "Bedingungen sollen
  einen Ausschluss oder Einschluss ermöglichen z.B. alle Knoten die NICHT
  im Ordner XY sind", but a *separate* standalone "Exclude" toggle/
  checkbox/segmented-button/icon next to the heading (several variations
  were tried) all read poorly - "die Vorschläge sind alle noch nicht
  optimal [...] Ganz anderer Ansatz gewünscht" - so the word *is* the
  control, no other element next to it. Click the word (e.g. "is" on a
  `Folder` criterion) - it should immediately flip to its negated form
  ("is not"), turn red (`--text-error`, vs. the default accent color), and
  the graph should re-apply live. The chip's own collapsed description
  should read the same flipped sentence (e.g. "Folder is not Archive"),
  not a generic "Not " prefix. `Property`, `Activity` (clusterFreshness),
  and `Structure` (structuralDeviation) do *not* get this word - each
  already has its own equivalent choice (the operator dropdown / the
  active-inactive bucket dropdown / the scattered-cohesive bucket
  dropdown). Reload
  the plugin (or restart Obsidian) - the negated state should persist per
  criterion. A criterion saved before this feature existed (no `negate`
  field at all) should still behave as included (not excluded), not error
  or silently invert.
- **Drag to pin a node** (force layout only): drag any note - its
  *neighbors* should visibly shift/readjust for a second or two after you
  release it (ForceAtlas2 briefly re-settling around the now-fixed
  dropped node - see `DRAG_SETTLE_DURATION_MS` in `graphPane.ts`), not
  just the dragged node jumping with nothing else reacting. Close and
  reopen the graph view (or reload the plugin) - the dragged note should
  reappear exactly where you dropped it, not back at its deterministic
  starting position. A plain click (no movement) must NOT pin the note
  where it already was. Try dragging while "Hierarchical" layout is
  active - dragging should do nothing there (by design, see
  `setupNodeDragging`'s docstring). Open the Appearance panel: its
  "Pinned node positions" section should show how many notes have a
  pinned position, with a "Clear all" button that actually clears them
  (verify a previously dragged note goes back to its normal position
  after using it). **With the Appearance panel already open**, drag a
  note - the count and "Clear all"'s enabled state must update
  immediately, not only after closing and reopening the panel (a real bug
  this exact scenario caught - user feedback: "funktioniert nicht immer,
  nur wenn eine Notiz vor dem Öffnen des Appearance-Dialogs verschoben
  wurde"; `finishDrag()` persisted the pin but never re-rendered the
  already-open panel, which only reads `pinnedPositions` at render time).
- **Click a node** (GitHub issue #10): should open that note in the editor,
  same as clicking a node in Obsidian's own core Graph View. Should still
  work after dragging some other node around.
- **Hover a node** (GitHub issue #9): should highlight only the hovered node
  itself with the accent color and always show its label - direct
  neighbors should keep their exact current color (not recolored) and show
  their label only if it would normally fit (same
  labelSizeThreshold/labelDensity rule as any other node, not forced), and
  everything else (non-neighbors) should visibly fade toward the background - clearly
  de-emphasized, but still recognizable as actual notes/edges, not faded to
  the point of disappearing. Should not open the note (that's the click,
  not the hover). Un-hovering should restore the view exactly as it was
  before - try hovering while cluster-freshness coloring or "Find path" is
  active: neighbors should keep showing their cluster/path colors
  untouched (just with their label now shown if it fits), and un-hovering
  should return to that view unchanged, not reset to plain default
  coloring.
- **Radial layout**: click "Radial…", pick `Hub` in the picker, click
  Apply - `Hub` should land dead center, its direct link neighbors on one
  ring around it, their neighbors on a ring further out, and `Island X`/
  `Island Y` (disconnected from `Hub`) on one additional outer ring beyond
  the farthest reachable ring. Re-picking a different note (e.g. `Topic A`)
  should re-center around that note instead - picking "Radial…" from the
  menu always reopens the picker, even while radial is already active,
  unlike the other options. Click "Force" to leave it. Dragging a node should
  do nothing while radial layout is active (same reasoning as hierarchical
  - see `setupNodeDragging`'s docstring).
- **Circular layout**: click "Circular" - every note should land on
  a single ring, with directly-linked notes (e.g. `Topic A` and `Topic A -
  Detail 1`) positioned near each other around the ring rather than
  scattered, so short chains of links read as short arcs rather than lines
  crossing the whole circle. Click "Force" to leave it. Dragging should do
  nothing while it's active.
- **Legend** (GitHub issue #13): a small panel, bottom-left, always visible,
  showing what the current colors mean. Empty (no panel shown - see
  `.clew-legend:empty`) with nothing active or with node groups active
  (user feedback: a group's own name, shown right in its row in the Color &
  size panel, is already its label - no separate legend entry); switches to
  "Shortest path" / "Alternative path" / "Not on a shown path" once "Find
  path" finds a result; switches to just "Shown" while the filter is active
  (no "no match" counterpart - non-matches are hidden, not dimmed).
  Activating the filter on top of a shown path result should switch the
  legend to the filter's own "Shown" label, not leave it describing the
  path underneath.
- **Appearance panel uses the dialog zone's full height, not the 70vh
  every other panel caps at** (user feedback: "Ganze Höhe für Dialog
  nutzen" - it has by far the most content of any panel here). Open it in
  a short/split pane (not just the full app window) - the panel's own
  scrollbar should kick in before its bottom edge ever runs past the
  pane's own bottom edge; previously (a `vh`-based max-height, resolving
  against the whole browser viewport rather than this specific pane) it
  could extend past a shorter pane's bottom, invisibly cut off there by
  `.clew-graph-view`'s `overflow: clip` with no way to scroll to the
  missing part. In a tall enough pane, every section (Nodes through Reset
  to defaults) should fit with no scrolling at all. Also click on the bare
  graph canvas in the empty space below the toolbar/wherever a panel isn't
  currently covering (`.clew-topbar` now spans the pane's full height to
  make the percentage sizing above possible, with `pointer-events: none`
  on the empty parts of that box specifically so this doesn't silently
  swallow clicks meant for the canvas) - normal graph interaction (drag to
  pan, click a node) should work exactly as before there.
- **Appearance panel**: click the sliders icon in the top-left icon rail -
  a panel opens in the dialog zone (top-left, directly below the icon
  rail - same slot as Filter/Color & size, see "Dialog zones, round 2"
  above) with "Nodes" and "Edges" sections (each with
  their own color picker and sliders), then grouped sliders (Physics /
  Labels / Radial or Circular or Hierarchical layout spacing), and a
  "Reset to defaults" button; clicking the icon again closes it. The
  layout-specific groups only show the one matching the currently active
  layout - Physics only while "Force" is active, "Radial layout spacing"
  only while "Radial" is active, etc. - and switching layout while the
  panel is open should swap them immediately, not just on next open. Drag
  the "Base node size" slider - nodes should visibly resize within a
  fraction of a second, no camera jump/re-settle (cheap repaint, not a
  layout restart). Drag "Gravity" or "Scaling ratio" - the force layout
  should visibly restart and re-settle with the new spread. Toggle
  "Dissuade hubs" (ForceAtlas2's `outboundAttractionDistribution`) on a
  hub-heavy vault - the hub's neighbors should visibly spread out around
  it instead of stacking on top of it, and the layout should restart the
  same as a slider drag does. Toggle "Tighter clusters"
  (`linLogMode`) - linked notes should pull into noticeably denser,
  more separated clumps. Both toggles live in the same "Physics (force
  layout)" section as Gravity/Scaling ratio - only visible while "Force"
  is the active layout, same as the sliders. Pick "Circular"
  from the "Layout" dialog, then drag "Circular layout radius" - the ring
  should resize live; pick "Radial" (choose a focus note) and drag
  "Radial ring spacing" - same live effect, centered on the same focus note
  without re-prompting. Drag "Label size threshold" - labels should
  appear/disappear at the current zoom level without a camera reset. Click
  "Reset to defaults" - every
  slider should jump back to its original position and the graph should
  visibly update to match. Close and reopen the graph view (or reload the
  plugin) - the last-saved values should still be in effect, not reset to
  defaults (they're persisted the same way as pinned positions, just
  edited from the graph view instead of the Settings tab).
- **Hovering a node shouldn't break rendering**: hover several different
  notes (including ones with long names) at various zoom levels - the
  hovered node's label box must render every time, in a box that's readable
  in both light and dark themes (not sigma's own hardcoded white box - see
  `createNodeHoverDrawer` in `renderer.ts`). A prior attempt at removing the
  zoom-based label threshold entirely (`Infinity`) made the *entire* graph
  disappear while hovering - if labels or the whole canvas ever go blank on
  hover again, suspect the same class of bug (an extreme/non-finite value
  feeding into a sigma setting).
- **Saved views** (GitHub backlog item 9, "Gespeicherte Ansichten/
  Workspaces" - bookmark icon in the top-left icon rail, `settings.ts`'s
  `SavedView`): click "Views…" - the icon should get the same accent
  highlight Appearance's own icon gets while its panel is open, and lose it
  again on close. Enable a filter (**with real matches**, not "no filter
  enabled"), enable a Color & size group, switch to Radial layout centered
  on some note, and apply Focus to a different note. Click "+ save current
  view" - the "+ save current view" button itself should disappear,
  replaced by a name field (pre-filled `View 1`) and an explicit "Save"
  button (Enter in the field also saves); click the field's "x" instead -
  the form should close with nothing created (re-open "Views…" to confirm
  no `View 1` row exists). This time type a name and click "Save" (or press
  Enter) - a new row should appear, and it should immediately show a
  checkmark/accent tint (`is-current-view`) since what it just captured is
  exactly the live state.
  - **The saved-filter bug**: with that same view's filter still enabled,
    verify the graph is actually still showing only the filtered notes
    (not everything) - this exact scenario (an enabled filter + no Focus)
    used to have `applySavedView()`'s Focus-clearing step silently wipe the
    filter's own hiding via `clearFocus()`, making the filter look ignored
    right after loading a view.
  - **Active-view marking (`appliedViewId`)**: this is a stateful pointer
    to "the view you're currently working from" - the one last Applied or
    just Saved - not a live "does some row's captured state still exactly
    match" check (an earlier version tried that and it broke Update, see
    below). Change something by hand (e.g. switch to Circular layout, or
    disable the filter) - the row should **keep** its checkmark even though
    its captured state no longer matches what's live; only Apply-ing a
    *different* view, or Save-ing a brand new one, should move the
    checkmark elsewhere.
  - **Update only ever touches the view you're in** (user-reported bug:
    "Update geht nur auf der aktuellen View" - Update always ended up
    reflecting whichever view was last applied, regardless of which row's
    icon you clicked, since "the current live graph state" is a single
    global thing with no inherent link to a specific row). The floppy-disk
    "Update" icon should now only be visible at all on the checkmarked row
    - confirm no other row shows it. With that row still current, change
    something (e.g. switch to Circular layout) and click its Update icon -
    it should silently re-capture the new state under the same name. Now
    create a second view (`View 2`) from a different state - `View 2`
    should get the checkmark and its own Update icon, and `View 1` should
    lose its Update icon entirely (not just the checkmark) until it's
    Applied again.
  - **Apply**: with two views saved, change everything to something that
    matches neither, then click `View 1`'s "Apply" (play) icon - the exact
    combination last saved into it should come back: same filter/group
    enabled, same layout, same Focus note/hops, and `View 1` should regain
    both the checkmark and its Update icon (`View 2` should lose both).
  - Close and reopen the graph view (or reload the plugin) - the saved view
    should still be listed and still apply correctly, same persistence as
    filterPresets/nodeGroups.
  - **A view restores the full filter/group definition, not just on/off**
    (user-reported: "Die Definitionen von Filtern und Color&Size wird nicht
    gespeichert, nur ob diese aktiv oder inaktiv sind"). Save a view with a
    filter enabled, then go edit that *same* filter's criteria in the
    Filter panel (add/remove a criterion) and leave it enabled - apply the
    saved view again: the criteria should snap back to exactly what they
    were when the view was saved, not stay as your later edit. Now delete
    that filter entirely (trash icon in the Filter panel) and apply the
    view once more - the filter should reappear in the Filter panel, fully
    defined and enabled, as if it was never deleted (not silently skipped).
    Same check with a Color & size group's criteria/color. A filter/group
    the view *doesn't* reference should be untouched by any of this except
    turned off if it was on.
  - Same check for Radial specifically (its note reference, not a
    definition it owns): apply a saved Radial view, then rename/delete the
    note it was centered on, then apply that view again - it should fall
    back to Force layout instead of erroring.
  - Trash icon deletes a view after a confirm dialog, same convention as
    deleting a filter/group.
- **Dynamic label size on zoom** (GitHub backlog item 13, "Dynamische
  Schriftgröße bei Zoom" - renderer.ts's `watchZoomForLabelSize()`): labels
  used to render at a single fixed size (sigma's own `labelSize`,
  independent of zoom) - overlapping into unreadable mush once enough of
  them packed into the same screen area while zoomed out. Open a vault with
  enough notes to have visible clustering, zoom to fit (or "Reset view"),
  then zoom out further with the scroll wheel/pinch past that point -
  labels should visibly shrink as you go, not stay full-size and overlap.
  Zoom back in - they should grow back, capped at their original size (not
  bigger than normal at 1:1 zoom or closer). `labelDensity` (*how many*
  labels are allowed to render per area) is untouched by this - confirm the
  *number* of labels showing at a given zoom looks the same as before, only
  their individual size differs. Also lowered `labelSizeThreshold`'s
  default from 9 to 2 (settings.ts's `DEFAULT_APPEARANCE_SETTINGS` - the
  Appearance panel's "Label size threshold" slider's own floor is already
  2) so more labels are visible to shrink in the first place - existing
  vaults keep whatever value they'd already saved; this only changes what a
  fresh install (or "Reset to defaults") starts at.
  **Regression, three rounds to actually root-cause**: switching Radial →
  Force crashed with "Uncaught RangeError: Maximum call stack size
  exceeded" - user-reported as "Wechsel von Radial auf Force => Fehler in
  der Console. Graph funktioniert dann nicht mehr", graph left unusable
  until the pane was reopened.
  - Round 1 (wrong): blamed the edges-after-panning feature below (newest
    change at the time) - disabling it entirely and reproducing again
    confirmed the crash was unrelated.
  - Round 2 (real bug, incomplete fix): a non-minified debug build
    (`sourcemap: 'inline'`, `minify: false` - the production build's
    minified stack trace alone wasn't enough to tell sigma-internal
    frames from this plugin's own) showed `watchZoomForLabelSize()`'s
    `update()` ping-ponging with sigma's own `setSetting()` ->
    `handleSettingsUpdate()` -> `camera.setState()` -> `updated` cycle
    (sigma's `setSetting()` unconditionally re-derives camera state on
    every call, regardless of which setting changed - sigma's own
    source, not something this plugin controls). Added a "did the label
    size actually change" guard before calling `setSetting()` again,
    reasoning the ratio genuinely kept changing during
    setForceLayout()'s repeating 150ms `resetCameraAndRefresh()`
    interval. Crash persisted - the guard was correct but not sufficient,
    for the reason round 3 found.
  - Round 3 (actual root cause): temporary diagnostic logging inside
    `update()` showed `camera.ratio` itself was `NaN` - not genuinely
    changing each call, just permanently broken. `NaN !== NaN` is always
    true, so round 2's guard (`current === next`) could never fire once
    the setting itself became `NaN`, and the ping-pong continued exactly
    as before. Traced further: a **pinned node position with a
    non-finite `x`/`y`** (`plugin.settings.pinnedPositions`, GitHub issue
    #12) flowed straight into ForceAtlas2 via
    `resetToDeterministicPositions()` (vaultGraph.ts) with no validation
    anywhere upstream - once FA2's repulsion math touches one NaN
    coordinate, NaN propagates through the *entire* simulation (every
    node it repels becomes NaN too), which poisons GraphPane's
    `fittedBBox()` extent, which poisons the camera's `ratio`. This
    explains why every earlier fix attempt failed to help at all: the
    corrupt coordinate lives in the user's saved settings (`data.json`),
    completely unaffected by any code change, and re-poisons the layout
    fresh every single time Force layout runs. Actually fixed at the
    source: `vaultGraph.ts`'s new `validPinnedPosition()` helper (shared
    by `buildVaultGraph()` and `resetToDeterministicPositions()`) treats
    a non-finite pin as if it weren't saved at all, falling back to the
    deterministic seed instead; `finishDrag()` (graphPane.ts) now refuses
    to *write* a non-finite position in the first place; `fittedBBox()`
    skips any node whose x/y still somehow isn't finite rather than
    letting one poison the whole extent (defense in depth);
    `watchZoomForLabelSize()` also keeps an explicit
    `Number.isFinite(camera.ratio)` guard as a last line of defense
    against this *specific* failure mode recurring from some future,
    different source. `vaultGraph.test.ts`'s "resetToDeterministicPositions
    falls back to the deterministic seed for a pin with a non-finite
    x/y" test covers this directly. For manual QA: drag a node in Force
    layout to pin it, then switch to Radial and back to Force a few times,
    including while ForceAtlas2 is still visibly settling - no console
    error, graph stays responsive, labels still resize correctly on zoom
    exactly as described above, and the pinned node stays exactly where
    you put it (a *valid* pin still round-trips correctly - only a
    corrupt one falls back).
- **Edges stay visible after panning** (`renderer.ts`'s
  `watchMoveForEdgeVisibility()`) - user report: "Nach dem Verschieben des
  Graphen werden oft nur die Punkte ohne Kanten dargestellt." sigma's own
  `hideEdgesOnMove` hides edges while the camera is considered "moving" and
  only patches visibility back for one specific path (a plain drag-release,
  via a fixed 0ms-after-mouseup refresh) - drag *inertia* (releasing the
  mouse while still moving kicks off a ~300ms coast that keeps
  `camera.isAnimated()` true well past that 0ms mark) and wheel-zoom
  (including a trackpad two-finger pan/pinch, which browsers report as
  `wheel` events) have no equivalent fix at all, so a repaint can land
  mid-coast/mid-tween and just show one more hidden-edges frame with
  nothing scheduling another. Check: click-drag the canvas to pan, release
  with some velocity (a real flick, not a slow stop) - edges should be back
  within roughly a third of a second of the coast actually stopping, not
  stay hidden. Scroll-wheel zoom in/out repeatedly, then stop - same check.
  If you have a trackpad, a two-finger pan/pinch on the canvas - same
  check. Deliberately keyed off the mouse captor's own gesture events
  (`mouseup`/`mouseleave`/`wheel`), not the camera's `updated` event -
  `updated` also fires for every programmatic camera change (including
  setForceLayout()'s own settle-tracking interval, see the "Dynamic label
  size on zoom" entry above for the real bug that combination caused), and
  the mouse-captor events never fire for one of those, only genuine user
  interaction.
- **Edge path style** (Appearance → Edges → "Edge path" dropdown,
  `renderer.ts`'s `createEdgePrograms()`) - user question: "Verschiedene
  Edge paths möglich?", citing sigma v4's five built-in path types
  (`pathLine`/`pathCurved`/`pathStep`/`pathStepCurved`/`pathCurvedS`), then
  "Berücksichtige alle" once shown the three-way straight/curved/S-curved
  breakdown below. Sigma v4 (and this plugin's two other sigma-family
  dependencies, `@sigma/node-border`/`@sigma/node-image`, used for
  basically every node) is still alpha/beta-only (checked via `npm view
  sigma versions`/`npm view @sigma/node-border versions` at the time:
  sigma itself `4.0.0-beta.0`, the node packages only as far as
  `4.0.0-alpha.3`) - not a foundation to build a shipped plugin's whole
  node/edge rendering on. Settled on three of the five, after laying out
  that risk explicitly and asking: **Straight line** (unchanged default),
  **Curved** (`@sigma/edge-curve@3.1.0`, a stable, officially-published
  companion package compatible with the v3.0.3 this plugin already
  depends on - a single gentle bend, fixed curvature, `@sigma/edge-curve`'s
  own default), and **S-curved** (`edgeCurvedSProgram.ts`, this plugin's
  *own* hand-written WebGL edge program - no such package exists even for
  sigma v4, whose own `pathCurvedS` is a genuine cubic Bézier with no
  simple closed-form point-to-curve distance the way a quadratic Bézier
  has; sidestepped by splitting each edge at its own geometric midpoint
  and drawing *two* ordinary quadratic-Bézier halves bulging opposite
  ways - reuses `@sigma/edge-curve`'s own, already-correct quadratic
  distance math unmodified for both halves, see that file's own docstring
  for the one visible tradeoff: a slight tangent kink at the midpoint, not
  a true cubic's smooth S). The two step variants (`pathStep`/
  `pathStepCurved`, right-angle routing) were explicitly left out - user
  decision. Skipped Step/Step-curved entirely (not built at all - if this
  scope changes, it needs its own new program the same way `curvedS` did,
  right-angle routing is a different technique from either quadratic
  Bézier half).
  - Switch the dropdown through all three with "Show edge direction" off -
    Straight: unchanged straight lines. Curved: every edge bends into one
    gentle, uniform curve. S-curved: every edge visibly bends one way then
    the other along its length (not just a single bulge) - the defining
    difference from Curved.
  - Turn "Show edge direction" on for each of the three - an arrowhead (or
    two, for a mutual link) should still point at the linked note,
    following whichever path shape is selected instead of always being a
    straight-line arrow; the "Arrow size" slider (only shown while "Show
    edge direction" is on) should scale the arrowhead the same way
    regardless of which of the three is selected.
  - Switch away from S-curved back to Straight or Curved - back to that
    shape cleanly, not a stuck S-curve or a rendering error (S-curved is
    genuinely new WebGL code, unlike Curved which reuses an existing,
    already-proven package - this is the one path worth double-checking
    doesn't leave anything visually broken behind when switched away
    from).
  - Hover/click a note, run Find-path, open the Diagnostics/Focus panels -
    with each of the three edge path styles active, confirm none of those
    (which all recolor/highlight specific edges via the shared edgeReducer
    pipeline) look broken or misaligned regardless of path shape - the
    path style only changes which WebGL program draws an edge's *shape*,
    every other edge-level attribute (color, highlight state, hidden) is
    untouched by it.
- **Heatmap overlay for cluster-style groupings** (`heatmapLayer.ts`'s
  `HeatmapLayer`, wired in `graphPane.ts`) - user request, alongside a
  ChatGPT-authored HTML prototype (`test-shadow/index.html`, its "heatmap"
  variant) demonstrating several possible group-highlight treatments: "die
  betroffenen Knoten [sollen] mit einer Dichtekarte / Heatmap ausgestattet
  werden, um die visuelle Zusammengehörigkeit zu zeigen" - first built for
  Diagnostics → Isolated clusters only, then extended twice more (same
  request, worded "Mach das gleiche mit Semantisches Clustering, Structural
  deviation", then "und für die Community-Funktion auch") to Structural
  deviation's own Show-in-graph toggle and to Semantic clustering's *and*
  Community's Color & size groups. Before this, Show in graph on Isolated
  clusters/Structural deviation only recolored the group's own nodes/edges
  (`primaryPathColor`) and dimmed everything else (`highlightNodeSet()`),
  and Community/Semantic clustering only colored their matching nodes flat
  via the ordinary Color & size pipeline - all four were readable
  member-by-member, but didn't visually read as *one group*. Added a soft
  Gaussian density field behind the graph instead, ported from the
  prototype's `field()`/heatmap-variant draw loop: a coarse grid (4px step)
  samples the sum of `exp(-distance² / (2·74²))` from every region's
  member nodes' *viewport*-space position (`renderer.graphToViewport()` -
  not graph-space, so the field stays correctly aligned as the camera
  pans/zooms/rotates) and fills a soft square per sampled point.
  `heatmapLayer.ts`'s `HeatmapRegion` generalizes this to any number of
  independently-colored node sets at once (needed for Community/Semantic
  clustering - several enabled groups, each its own cluster/community and
  own color, can be visible simultaneously), each region drawn as its own
  full grid pass with its own color rather than one shared multi-color
  field.
  - **Isolated clusters/Structural deviation** (`highlightNodeSet()`,
    shared by both `toggleClusterHighlight()` and
    `toggleDeviationHighlight()`): one region, `theme.primaryPathColor`
    (`theme.ts`'s `parseRgbString()`, now exported, resolves it to an
    `[r,g,b]` triple a 2D canvas `rgba()` fill needs), tracked in
    `clusterHighlightRegion` - set on a Show-in-graph click, cleared by
    `clearClusterHighlight()` (both toggles' shared "un-highlight" path).
  - **Community/Semantic clustering** (`computeClusterGroupHeatmapRegions()`,
    called from `paintVisualEncoding()`): one region per *enabled* Color &
    size group whose criteria include `community` or `semanticCluster`,
    reusing the same `groupByNode` map (`evaluateGroups()`)
    `paintVisualEncoding()` already computes for ordinary node coloring - a
    note in the overlap of two such groups gets a heatmap glow matching
    whichever group's color actually painted it (first-enabled-group-wins,
    same precedence as the coloring itself), not both. Each region's color
    is that group's own `color` field, so the glow always matches the
    group's node fill exactly. Continuous, not toggle-based (recomputed on
    every repaint) - neither criterion has a Diagnostics "Show in graph"
    list of its own; a group being enabled in the Color & size panel already
    means the user asked to see it. Deliberately does NOT extend to
    `structuralDeviation` groups (a different criterion from the one behind
    Diagnostics → Structural deviation's own per-community list above,
    despite the similar name) - its single boolean bucket lumps every
    scattered community together regardless of which one, so a heatmap over
    *that* would just be several unrelated smudges; `community` and
    `semanticCluster` both pin one specific cluster/community id per group
    instead, meaningfully colocated by construction.
  - `updateHeatmapRegions()` composes `clusterHighlightRegion` (at most one,
    the Diagnostics toggle) with `clusterGroupHeatmapRegions` (any number,
    from Color & size) into whatever `this.heatmapLayer` actually draws -
    the single call site both kinds of region change go through, so neither
    clobbers the other (e.g. Show-in-graph'ing an isolated cluster while a
    community/semantic-cluster group is also enabled shows both glows at
    once, not just the most recently set one).
  - Own `<canvas>` (`.clew-heatmap-layer` in styles.css), `prepend()`ed into
    `graphContainerEl` so it sits behind every canvas Sigma itself manages
    (background/edges/nodes/labels/hovers/mouse, all
    `position: absolute; inset: 0`, none with an explicit z-index - DOM
    order decides among ties, backed up by an explicit `z-index: 0` in CSS
    too), `pointer-events: none` so it never steals clicks/drags meant for
    the graph above it. Redrawn on the camera's `updated` event, Sigma's own
    `afterRender` event, and a `ResizeObserver` on the container - same
    "redraw on every input that could have moved something" trio the
    prototype used. Recreated alongside `this.renderer` on every
    `setFiles()` (a fresh Sigma instance needs its own camera/afterRender
    listeners; the old layer's are torn down first via `destroy()`, same
    place `this.renderer` itself gets killed - `paintVisualEncoding()` runs
    *before* the new layer exists during `setFiles()`, so its
    `updateHeatmapRegions()` call there is a no-op; `setFiles()` explicitly
    calls it again right after creating the fresh layer to flush the
    already-computed `clusterGroupHeatmapRegions`) and torn down in
    `destroy()` (GraphPane's own lifecycle end).
  - For manual QA: open Diagnostics on a vault with at least one isolated
    cluster (or fabricate one - a couple of notes linking only each other,
    cut off from everything else), click "Show in graph" on it - a soft,
    blurred glow should appear behind the cluster's nodes, roughly the
    theme's accent color, in addition to the existing recolor/dim treatment;
    pan and zoom the canvas while it's showing - the glow should track the
    nodes exactly, never lag or drift; click "Show in graph" again (or on a
    different cluster row) to toggle it off/switch - the glow should
    disappear/move cleanly, no stale patch left behind. Open Structural
    deviation instead and click its own "Show in graph" - same glow
    treatment now, not just recolor/dim. Open Color & size, add a group with
    a `community` criterion, enable it - a glow should appear continuously
    (no toggle needed) behind that community's nodes in the group's own
    color; add a group with a `semanticCluster` criterion instead (wait for
    embeddings to finish computing - Diagnostics/Color & size panel shows the
    loading state) - same continuous glow treatment; enable both a
    `community` and a `semanticCluster` group at once, plus a second of
    either kind for a different cluster/community - every enabled group's
    glow should be visible simultaneously, each its own color; disable one
    group - only its glow disappears, the others stay. Add a group with a
    `structuralDeviation` criterion and enable it - deliberately no
    continuous glow for that one (see the scoping note above); its own
    per-community glow only comes from Diagnostics → Structural deviation's
    "Show in graph" list, unrelated to this Color & size group. With a
    community/semantic-cluster group enabled, also Show-in-graph an isolated
    cluster - both glows should show simultaneously, and clearing the
    isolated-cluster highlight should leave the other glow(s) untouched.
    Switch layouts (Force/Radial/Circular) and refresh the vault
    (edit/create/delete a note) while any of these are showing - no console
    error, every overlay clears or updates with the rebuilt graph rather
    than pointing at stale/removed nodes.
  - **"Cluster heatmap" toggle** (Appearance panel, `ClewAppearanceSettings.
    showClusterHeatmap`, on by default) - user request: "Bau ein Setting
    ein, so dass der Hintergrund deaktiviert werden kann". A single on/off
    switch for the whole overlay, checked once inside
    `updateHeatmapRegions()` (the one shared call site every region change
    already goes through) rather than in each region-computing caller -
    turning it off calls `heatmapLayer.setRegions([])` regardless of what
    `clusterHighlightRegion`/`clusterGroupHeatmapRegions` currently hold,
    without touching either of those fields, so turning it back on
    immediately shows whatever was already highlighted/enabled rather than
    needing to re-trigger it. Deliberately doesn't touch the *other* half of
    the same highlights (Isolated clusters/Structural deviation's own
    recolor/dim `nodeReducer`/`edgeReducer`, Community/Semantic clustering's
    ordinary node coloring) - only the glow layer. For manual QA: with an
    isolated cluster's "Show in graph" active and/or a community/semantic-
    cluster group enabled (glows visible per the checks above), open
    Appearance and turn "Cluster heatmap" off - every glow should disappear
    immediately, while the recolor/dim and node coloring underneath stay
    exactly as they were; turn it back on - the same glow(s) should
    reappear without needing to re-click "Show in graph" or re-toggle any
    group. "Reset to defaults" should turn it back on if it had been off.
- **Focus/Diagnostics icons mark themselves active while open** (user
  feedback: neither lit up at all, unlike Filter/Color & size/Appearance/
  Views): click "Focus…" - the crosshair icon should get the accent
  highlight immediately, even before picking a note (an empty, nothing-
  focused-yet panel still counts as "open"). Click it again to close - the
  highlight should clear. Same check for "Diagnostics…" (stethoscope icon).
  Open Focus, then click Diagnostics without closing Focus first - Focus's
  panel and its icon highlight should both clear (closeOtherPanels()'s
  mutual-exclusion), and Diagnostics' icon should light up instead; then
  close Diagnostics - no icon should stay highlighted.

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

The page's on-screen HUD logs node/edge counts, layout settle time, and a rolling average frame time. A subset of nodes render with a placeholder image, to exercise sigma's image-node program.

### 2. A large test vault (only testable in the app)

```bash
node scripts/gen-graph-vault.mjs   # writes ./spike-vault: 10,000 notes with a hub-heavy link structure
```

1. Symlink the build output in file by file, same as the [manual QA vault](#3-manual-qa-vault) above (not a whole-directory symlink - see that section for why):
   ```bash
   mkdir -p spike-vault/.obsidian/plugins/clew
   ln -s "$PWD/main.js" "$PWD/manifest.json" "$PWD/styles.css" spike-vault/.obsidian/plugins/clew/
   ```
   Then open `spike-vault` in Obsidian and enable the plugin.
2. Use the ribbon icon or the **"Open graph view"** command.
3. Check: pan, zoom, click a node (should select without noticeable lag), and confirm the ~100 image nodes render their cover image - this exercises `app.vault.getResourcePath()` feeding a WebGL texture (the browser harness only proves sigma *can* render images at all, not that a real vault image loads cleanly).

### Known open item

The graph view has not yet been checked on a tablet (Obsidian mobile). Desktop performance has comfortable margin (steady 60fps at 10k nodes), so this isn't currently blocking feature work, but it hasn't been confirmed either - worth doing before relying on mobile behavior for anything.

User-reported (2026-08-05): the plugin failed to load on mobile at all
- `esbuild.config.mjs` marked every Node builtin (via `node:module`'s
  `builtinModules`) `external`, including `'events'`. Desktop Obsidian
  (Electron) has Node integration, so a bare `require("events")`
  resolves there for free; mobile has no Node runtime at all, so that
  same call failed the instant the bundle was evaluated, before
  `onload()` even ran - surfaced as a flat "Failed to load plugin",
  no further detail. sigma/graphology both use `require('events')`
  internally for their own EventEmitter - fixed by excluding `'events'`
  specifically from the external list, letting esbuild bundle the
  `events` *npm package* instead (a browser-safe polyfill of the same
  API - already an existing transitive dependency of both, not Node's
  own module). Confirmed fixed: `grep -oE "require\([^)]+\)" main.js`
  now only shows `require("obsidian")`.
- This only explains the *load* failure, not interaction quality -
  `setupNodeDragging()`/`setupNodeHover()` are wired to Sigma's mouse
  captor (`getMouseCaptor()`), not a touch captor, so pin-by-dragging
  and (especially) hover-to-highlight-neighbors likely don't work
  meaningfully on a touchscreen (no real "hover" state on touch at
  all) even now that the plugin actually loads. Still unverified: pan/
  zoom quality, tap-to-open, and whether the ForceAtlas2 Worker (Blob
  URL-based) spawns reliably on iOS Safari WebKit.

`spike-vault/` and `spike/dist/` are gitignored - regenerate them locally; they never land in a commit.

User-reported: `Uncaught Error: Sigma: could not find a suitable program for node type "image"!` in the console on a vault refresh (any note created/edited/deleted while the graph view is open - not just plugin reload, though that's one way to trigger it too)
- Root cause: `GraphPane.setFiles()` calls `this.renderer?.kill()` then, a few lines later, `this.activateLayoutMode('force')` - which (since an earlier fix taught it to also repaint the Radial-layout ring, see `activateLayoutMode()`'s own docstring) calls `applyNodeSizeSettings()` -> `this.renderer?.refresh()`. `kill()` tears down a Sigma instance's own node/edge programs (its `nodePrograms` map ends up empty) but doesn't null out the `this.renderer` field itself - so that `refresh()` call ran against the just-killed, program-less instance, moments before `setFiles()` creates the real replacement a few lines further down. Sigma throws the moment it then tries to draw *any* node, cover-image notes (`type: 'image'`) being the most likely first one it reaches, but not the only possible trigger.
- Why this went unnoticed for a while: the *very first* `setFiles()` call in a fresh view has `this.renderer` already `null` (nothing to kill yet), so optional-chaining harmlessly no-ops there - the crash only hits the *second and later* calls, i.e. any vault refresh after the graph view's initial load. Very likely the same underlying issue behind an earlier, never-fully-explained "graph not rendered after plugin reload" report from earlier in this project's history.
- Fix: `this.renderer = null` immediately after `kill()` in `setFiles()`, so every `this.renderer?.` call in between (there's exactly one live risk today, but this closes the whole class of it) safely no-ops until the fresh instance is assigned.
- Manual QA: open the graph view, then create/edit/delete a note (or just wait for any metadata-cache-resolved refresh) - the console should stay clean; previously this threw on the *second* such refresh in a vault containing at least one cover-image note.

## Spike: semantic clustering (GitHub backlog item 16)

GitHub backlog item 16, "Semantisches Clustering", asked for a design decision before any implementation: local embedding model vs. a cloud API with opt-in, informed by a short spike measuring feasibility on this project's own test vault. This section documents that spike's result - the throwaway script itself (`spike-embeddings/`) was not committed, same convention as every other one-off verification script in this project's history; only the finding is kept.

**Decision: local is feasible, and clearly preferable.** A cloud API would mean sending note content (private, personal-vault text) to a third party on every edit - a much bigger trust/privacy ask than anything else this plugin does, and a recurring cost/rate-limit dependency for a feature that's supposed to "just work" offline like everything else in Clew. Local was only in question because of bundle size and whether it'd run at all inside Obsidian's Electron/mobile-WebView environment without native Node dependencies (this project has hit that exact class of bug before - see "User-reported: the plugin failed to load on mobile" above, a Node-builtin issue). The spike answered that concretely, not by assumption:

- **Library**: [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) (transformers.js) - runs entirely in-browser via ONNX Runtime Web (WASM), no server, no Node APIs. `esbuild --bundle --platform=browser` on a minimal entry point bundled it cleanly to **~1.2MB** (dominated by `transformers.web.js` itself, ~999KB) with **zero Node-builtin `require()` calls** in the output - the exact failure mode that broke mobile loading before did not reappear here. Clew's current `main.js` is 403KB, so shipping this roughly triples it - a real but not disqualifying jump for a desktop-first plugin; mobile bundle-size/perf on a real device is still unverified (same open item as touch interaction generally - see above).
- **Model**: `Xenova/all-MiniLM-L6-v2`, 8-bit quantized (`dtype: 'q8'`) - a 22MB one-time download (cached after first use; not part of the plugin's own release asset unless deliberately bundled for full-offline installs, which would balloon the GitHub release from a few hundred KB to ~25MB - a real distribution tradeoff to decide explicitly if this is built, not default to). Loaded (cold, including the download) in ~2.2s.
- **Throughput**: embedding this repo's 27-note test vault (mostly bare titles + `[[links]]`, almost no body text - see `scripts/gen-test-vault.mjs`) took **68ms total (~2.5ms/note)** on a plain M-series laptop CPU, no GPU/WebGPU involved. Linearly, a 10,000-note vault (this project's own standing perf-regression size, see "Performance testing at scale" above) would be roughly 25s for a full first-time embed - fine as a one-time background job with a progress indicator, not something to redo per keystroke (the real feature would cache each note's embedding, keyed by content hash or mtime, and only re-embed on change - same "cache, don't recompute" shape as `staleness()`/community detection already use in `stagnation.ts`).
- **Quality, on real (if sparse) content**: cosine similarity over every *unlinked* pair in the test vault correctly surfaced the intended families at the top with a clear separation from noise - `Topic A <-> Topic B` (0.920), `Old Cluster A <-> Old Cluster C` (0.798, genuinely unlinked but named as a cluster), the `Scattered *` notes clustering with each other in the 0.77-0.81 range - while the vault's one deliberately-unrelated note (`Isolated`) scored 0.03-0.13 against everything, the clear bottom of the ranking. This is a strong signal already, and the test vault's notes barely have body text at all (see `gen-test-vault.mjs`) - a real vault with actual prose would give the model more to work with, not less.

**Implemented** (same session, once the decision above was confirmed): a `semanticCluster` group criterion, following through on every one of this section's original "Not done in this spike" items:

- **`src/graph/semanticClustering.ts`** - pure graph/vector math, no dependency on the embedding model or Obsidian at all (fully unit-tested with synthetic vectors, no network/WASM/model download in `npm run test`): `cosineSimilarity()`, `buildSimilarityGraph()` (a top-K-nearest-neighbor graph, `SIMILARITY_KNN = 8` candidate edges per note, `SIMILARITY_MIN = 0.35` floor below which even a nearest neighbor doesn't count - see that constant's own docstring for how it was picked relative to the spike's own numbers), and `detectSemanticClusters()` (Louvain over that similarity graph, weighted by cosine similarity, ranked by size the same way `communityId` already is - 0 = the largest cluster present).
- **`src/graph/embeddingModel.ts`** - the one (and only) place `@huggingface/transformers` is actually imported, kept separate from the module above for exactly that isolation. `loadEmbeddingModel()` is a module-level singleton (memoized for the whole plugin session, not per-GraphPane-instance) with an optional progress callback; `embedText()` wraps one note's "title\ncontent" into a mean-pooled, L2-normalized vector.
- **`nodeGroups.ts`**'s new `semanticCluster` criterion mirrors `community` exactly (a note-picker resolving to a cluster id, ranked-by-size numbering, `needsSemanticClustering()` gate) - see `SemanticClusterCriterion`'s own docstring for why it's a genuinely separate mechanism from `community`, not a variant of it: two notes with identical content but zero (even indirect) shared links can never land in the same Louvain *community*, which is exactly the case this criterion exists to catch.
- **GraphPane** wires this into the exact same async-then-repaint pipeline `text`/`noteContentCache` already uses (`refreshCriteriaContent()`) - adding/enabling a `semanticCluster` criterion triggers `refreshSemanticClusters()` (model load -> embed every not-yet-cached note, keyed by `path:mtime` so an edited note is transparently re-embedded -> cluster), surfaced in the Color & size panel as "Computing embeddings…" while in flight.
- **Known, deliberate tradeoffs** (not gaps found later - flagged up front, same as the spike's own honesty about what it hadn't checked): the model and its ONNX Runtime Web `.wasm` binary are still fetched from their default CDN (jsdelivr/HF Hub) rather than bundled into the plugin's own release asset - a first-use, one-time network dependency, cached by the browser afterward; `main.js` grew from ~403KB to **~923KB** (verified via a real production build, not estimated); the per-note embedding cache is session-lifetime only (an instance field, not written to `data.json`) - closing and reopening the graph view keeps it, a full plugin/Obsidian reload does not, so a large vault's first `semanticCluster` use after every reload re-embeds from scratch; inference still runs on the main thread (chunked by nothing more than JS's own per-`await` yield between notes) rather than a dedicated Web Worker - acceptable at the vault sizes this plugin targets (the spike's own ~25s/10k-note projection), but a real jank risk on a much larger vault or a slower machine.
- **Verified against the real (not synthetic) test vault**, running the actual production `embeddingModel.ts`/`semanticClustering.ts` end-to-end (a throwaway script, not committed): the vault's one deliberately-unrelated note (`Isolated`) landed alone in its own cluster, and the loosely-related `Scattered */Island X/Island Y` notes clustered together, separately from the `Topic`/`Cluster` family - a coarser grouping than the spike's own raw pairwise similarity ranking (whole-graph Louvain optimizes overall modularity, not "closest pair"), which is expected, not a regression - see `buildSimilarityGraph()`'s own docstring for the `SIMILARITY_KNN`/`SIMILARITY_MIN` reasoning if this needs tuning later.

Manual QA: enable a `semanticCluster` criterion in the Color & size panel ("+ add" → "Semantic cluster") - the panel should show "Computing embeddings…" for a few seconds on the first use (longer on a slow connection, since the model downloads then), then a note-picker; pick any note and confirm the group colors both it and whichever other unlinked notes are actually about the same thing. Reopen the criterion after a note's content has changed - its embedding should update (not show stale results) without needing to re-pick anything.

User feedback: "Wird eine Community gewählt, dann wird z.B. 'Community 14' [...] gezeigt. Das ist nicht userfreundlich" - a raw Louvain/cluster rank means nothing without opening the graph to check what's in it. Fix (`CommunityCriterion`/`SemanticClusterCriterion`'s new `sampleLabel` field, `nodeGroups.ts`): the note picked in the note-picker becomes the display label from then on - the chip/badge reads `Community is like "Project Notes"` instead of `Community is 14`. Manual QA: add a `community` (or `semanticCluster`) criterion, pick a note - the collapsed chip and the edit row's own badge should both immediately show that note's name, not a number; collapse and reopen the criterion - the label should still show the picked note's name (persisted, not re-derived). Pick a *different* note afterward - the label should update to the new one. This is purely a display label - matching itself is unaffected, still keyed by the underlying rank (`communityId`/`clusterId`), so an existing criterion saved before this field existed still matches exactly the same notes it always did, just displayed as a plain number again until re-picked.

User-reported, two rounds, both inside `embeddingModel.ts`'s model load and both really the same underlying bug:

**Round 1** - `TypeError: Cannot read properties of undefined (reading 'create')` the first time a `semanticCluster` criterion tried to load the model. First fix attempt: ONNX Runtime Web's multi-threaded WASM backend needs `SharedArrayBuffer`/`crossOriginIsolated`, which Obsidian's `app://` origin doesn't grant (no COOP/COEP headers) - added `env.backends.onnx.wasm.numThreads = 1` (ONNX Runtime Web's own documented single-thread fallback) plus an explicit `device: 'wasm'`. Verified working in a plain (non-Electron) `python3 -m http.server` page with `crossOriginIsolated: false` - a real fix for a real problem, but not the *whole* problem, which round 2 exposed:

**Round 2** - after that fix, a *different* error: `Error: Unsupported device: "wasm". Should be one of: coreml, webgpu, cpu.` The real, complete root cause, found by reading the installed `@huggingface/transformers` package's own source (not assumed): the library decides whether it's "running in Node" with `process?.release?.name === "node"`, computed once at its own module-evaluation time and frozen into an internal `apis` object. Electron's renderer - what Obsidian's desktop app actually is - sets `process.release.name` to `"node"` too (Node integration), even though the JS/WASM runtime executing this code is Chromium's, not Node's. Misdetected as Node, the library:
- Restricts its device whitelist to `["coreml", "webgpu", "cpu"]` (no `"wasm"`) - the round-2 error.
- Worse, binds its actual ONNX backend to `onnxruntime-node`'s exports - except the *browser* build of transformers.js (`transformers.web.js`, the only build this plugin ships, having no Node-native binaries to ship for the other one) has that import stubbed out to an empty module at its own build time. So `ONNX.InferenceSession` is `undefined`, and the very first call into it throws exactly the round-1 error - regardless of which `device` string is passed, since this happens before any device-specific logic runs. **No choice of `device` value alone can fix this** - round 1's fix was necessary but not sufficient.
- Fix (`embeddingModel.ts`'s `loadTransformers()`): since the misdetection is baked in once, at first import, it has to be fixed *before* that import, not after - a static `import` (what round 1 still had) is hoisted and evaluated before any of this file's own code can run, so there's no way to intervene in time. Switched to a *dynamic* `import()`, bracketed by a temporary, narrowly-scoped shim for just the duration of that one call, restored immediately after in a `finally`. With `IS_NODE_ENV` correctly `false`, the library binds to the real `onnxruntime-web` build instead, and `wasm` becomes valid again.
- Verified against the actual failure condition, not just a generic "does it still work" check: a `python3 -m http.server` page pre-seeding `window.process = { release: { name: 'node' }, ... }` *before* the bundle (built the same `esbuild --platform=browser` way the real plugin is) ever runs - reproducing Electron's exact misdetection - running the real production `embeddingModel.ts`. Confirmed: model loads, returns a real 384-dimension vector.

**Round 3** - user-reported, after round 2's fix shipped: `TypeError: Cannot assign to read only property 'release' of object '#<process>'`, thrown from inside `loadTransformers()` itself. Round 2's shim mutated `process.release` *on the real process object, in place* (`proc.release = {...}`) - works in plain Node.js, where `process.release` is an ordinary writable property, but Electron locks that specific property down (read-only), even though `window.process` as a whole is still a plain, reassignable property. Fix: swap out `window.process` itself for a shallow copy (every other property - `versions`/`platform`/`arch`, all of which transformers.js's own device-selection code also reads - copied through unchanged, only `release` overridden) instead of mutating a property on the original, still-referenced object; restored via the same `finally`. Verified with the same http.server harness as round 2, this time with the shimmed `process.release` made genuinely non-writable/non-configurable (`Object.defineProperty(..., { writable: false, configurable: false })`, an exact match for the real `TypeError`'s wording) to actually reproduce round 3's failure mode rather than just round 2's - confirmed the direct-mutation attempt now throws exactly that error *inside the test itself* (proving the repro is faithful), while `loadTransformers()`'s own object-swap approach still succeeds, and `window.process` is restored to the exact original object afterward (`===` identity check, not just an equivalent copy). Not verified inside Obsidian itself in this session.

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
