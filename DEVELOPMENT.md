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
    standaloneGraphView.ts   # the "Clew graph view" - ribbon icon / "Open graph view" command, whole vault
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

- **Find path**, `Topic A - Detail 1` → `Topic B - Detail 1`: should offer a
  route through `Bridge Note` as an alternative to the naive route through
  `Hub` - the hub-avoidance cost model should make the Bridge Note route rank
  competitively despite `Hub` being the shorter hop count.
- **Find path**, anything → `Island X` or `Island Y`: should report "no path
  found" (a first-class result, not an error) - `Island X`/`Island Y` are a
  deliberately disconnected two-note component.
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
- **`With Cover`** should render its frontmatter `cover` image as the node,
  not a plain dot.
- **`Isolated`** (no links at all) should still render with degree 0 and be
  colorable by any group whose criteria it happens to match (e.g. a
  `filename`/`tag`/`property` criterion) - Louvain still assigns it its own
  single-note community, so a `clusterFreshness` criterion can match it too.
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
  since several enabled filters combine with OR (see below), reordering
  must have *no effect* on which notes are shown - unlike a node group's
  own drag-to-reorder, which does control color precedence. Its edit form
  is the group edit form minus the color picker and "Scale size" toggle:
  a name field, then the exact same
  "Criteria" chip list + "+ add" menu Color & size uses (including
  `Not edited at least (days)`/`Minimum number of links`/`Activity`, not
  just the original text/tag/property set), AND'd within one filter, same
  as a node group's own criteria. **Multiple filters (OR)**: create a
  second filter, enable both - a note should show if it matches *either*
  enabled filter (user feedback, choosing OR over "only one filter active"
  or "AND across filters" so several saved filters behave like a small
  library of alternative searches); disabling one should immediately drop
  its notes from the shown set unless the other filter also matches them.
  Deleting a filter (with a confirm dialog, same as deleting a node group)
  should immediately stop it affecting the graph. **No legend entry**
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
  silently dropping `hidden`). Opening "Appearance…" while the filter
  panel is open (or vice versa) should leave both open now - they no
  longer share a corner. **Enabling a `text` filter after a content-
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
- **Layout selection** (`layoutModal.ts`): a single "Layout: Force" toolbar
  button (its own tooltip always shows the current mode) opens a dialog -
  not a dropdown menu (user feedback: picking a layout should come with an
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
  is created, saved, and opens directly in its edit form under a "Group"
  heading (same bold style as "Criteria" below, and as Appearance's own
  "Nodes"/"Edges"), with an *unlabeled* color+name row right underneath -
  color swatch flush left, title field stretching to fill the rest of the
  row. Set the name to "Status A", click "+ add" - it should sit flush
  with the "Criteria" heading below (not just its own text nudged in with
  the button's border/background still sitting at the form's own left
  edge - an earlier version got this wrong: a plain div can be aligned by
  nudging its *content* with padding, but a button has its own visible
  box, so it needs its whole box shifted with a margin instead). It opens
  a small menu (Tag / Property / Folder / Filename / Text / Stagnation,
  the same Menu-based pattern the "Layout" toolbar button used before it
  became its own explanatory dialog) - pick
  "Property" and the new criterion opens directly in its expanded
  controls (not yet a chip, since it still needs configuring), reading top
  to bottom as **heading, then fields, then actions**: a "Property" label
  on its own line, the key/operator/value controls on the line(s) below
  it, and the checkmark/"x" on their own line under those (never crammed
  onto the same line as the fields, even if the fields themselves wrap);
  set it to `status` / "Equals" / `done` - *without clicking anything
  else*, every note with `status: done` (`Topic A`/`Topic A - Detail
  1`/`Topic A - Detail 2`) should immediately take that color and the
  palette icon should highlight - **everything here saves immediately as
  you go, there is no separate Save step anywhere in this panel**. Click
  the checkmark next to the criterion - it should collapse into a compact
  chip reading `status equals "done"` (nodeGroups.ts's
  `describeCriterion()`), flush-aligned with the "Criteria" heading and
  its description text right above it. **Cancel reverts, not deletes**:
  click an existing chip to re-expand it, change its value, then click the
  "x" (not the checkmark) - it should revert to what the chip showed
  *before* you started this edit, not delete the criterion (an earlier
  version deleted it - user feedback: "x" while editing should mean
  Cancel). For a criterion you just added via "+ add" (never had a
  "before" state), the same "x" removes it instead, since there's nothing
  to revert to. A chip's own "x" *while collapsed* still removes it
  directly, no expand needed. **Chips**: with several criteria configured,
  the "Criteria" section should read as a short row of wrapping chips, not
  a wall of dropdowns/text fields all shown at once. **Wrapped tag
  pills**: expand a `tag` criterion and pick enough tags that its pills
  wrap onto a second line - the wrapped line should stay inside the
  criterion's own controls, not jump to the panel's own left edge, and the
  checkmark/"x" row should still land on its own line below all of it, no
  matter how many lines the fields wrapped onto. **No empty-state text**:
  a brand new group with no criteria yet should show no placeholder line
  under "Criteria" at all - just the heading, description, and the "+
  add" button. **Multiple criteria (AND only)**: add a `tag` criterion too
  - now only notes matching *both* the property AND the tag should stay
  colored (every criterion in a group is AND'd, with no OR/grouping option
  - the "Criteria" heading's own description says "A note must match every
  criterion below."). **Size multiplier**: "Scale size" is off by default
  on a new group; toggle it on - a "Size multiplier" slider appears (no
  explanatory text under it - its own live tooltip while dragging is
  enough), range 0.3-3, starting at 1; drag it to 2 - matching notes
  should visibly grow, but a hub note among them should still look bigger
  than a leaf note in the same group (it's a *multiplier* on each note's
  own degree-based size, not a fixed size replacing it - user feedback: an
  earlier absolute-size version made every matching note identically
  sized, losing the hub-vs-leaf signal entirely); at exactly 1 every
  matching note's size should be unchanged from default. Toggle "Scale
  size" back off and sizes should return to fully default. **Closing a
  group's edit form**: there is no standalone "Done"/Save/Cancel button at
  the bottom any more (removed - user feedback: nothing was left for it to
  commit) - the only way to collapse the form back to the group's row is
  the small "x" next to the "Group" heading itself, at the top.
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
  after using it).
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
- **Appearance panel**: click the sliders icon in the top-right icon rail -
  a panel opens bottom-right with "Nodes" and "Edges" sections (each with
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
  should visibly restart and re-settle with the new spread. Pick "Circular"
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
