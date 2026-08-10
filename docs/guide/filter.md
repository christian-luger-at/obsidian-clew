# Filter

Click the **Filter** toolbar icon to open the Filter panel - a list of named, reusable filters you create yourself. With none enabled, every note shows; enabling one or more hides every note that doesn't match.

<figure class="shot shot-narrow">
  <img class="doc-shot light-only" src="/screens/filter-panel-light.png" alt="The Filter panel with two filters set up, light theme">
  <img class="doc-shot dark-only" src="/screens/filter-panel-dark.png" alt="The Filter panel with two filters set up, dark theme">
  <figcaption>Two saved filters - one enabled, one not.</figcaption>
</figure>

## Creating a filter

Click **"+ new filter"** to add one, then click its pencil icon to edit it. Give it a name, then click **"+ add"** to add criteria to it. A note matches a filter only if it satisfies **every** criterion in that filter - criteria within one filter always AND together.

## The criteria

Two kinds of criteria: plain ones that look at a note directly (its text, tags, properties, links), and analytics ones computed from the whole link graph (bridging, prominence, activity, structure, connectivity, community). Every [Color & size](./color-and-size) group uses exactly the same criteria, applied to coloring/sizing instead of hiding.

### Plain criteria

- **Text** - the note's title or body contains a word or phrase (case-insensitive substring match).
- **Tag** - the note has any of the tags you pick (one criterion covers several tags at once - no need for a separate row per tag).
- **Property** - a frontmatter value, compared with `contains` / `equals` / `does not equal` / `is empty` / `is not empty`.
- **Folder** - the note's path is inside this folder, including subfolders.
- **Filename** - the note's title (not its body) contains a word or phrase.
- **Not edited at least (days)** - the note hasn't been modified in at least this many days.
- **Minimum number of links** - the note has at least this many links (its degree in the graph, in + out combined).
- **Existence** - whether the node is a real note, or a *ghost node* - a link to a note that doesn't exist yet. Use this to show only the gaps in your vault (notes you've linked to but never created), or to hide them entirely. Two ready-made filters, **"Show existing notes"** and **"Show non-existing notes"**, are available out of the box (disabled by default) so you don't have to build this one from scratch.

### Analytics criteria

These run the same graph algorithms the [Diagnostics](./diagnostics) panel uses, so you can turn any of them into a reusable filter (or a [Color & size](./color-and-size) group) instead of only reading them off a list.

- **Bridging** (betweenness centrality) - whether a note lies on the shortest path between many *other* pairs of notes, i.e. how much of a structural bridge it is. A note can have very few links and still score high here, if it's the only connection between two otherwise-separate parts of the vault - that's what sets it apart from "Minimum number of links." Choose "connects otherwise-separate notes" (top half of what's present) or "not a bridge note" (bottom half).
- **Prominence** (PageRank) - how prominent a note is, weighted by how prominent the notes linking to it are. Ten links from ten obscure notes count for less than one link from an already-prominent hub - unlike "Minimum number of links," which treats every link the same. Choose "a prominent note" (top half) or "not a prominent note" (bottom half).
- **Activity** - whether a note sits in an active or inactive neighborhood of the vault. Clew groups tightly-linked notes into communities (see "Community" below), then compares how recently each community was edited overall. Choose "active area of the vault" or "inactive area of the vault." This is about the *neighborhood*, not the individual note - see "Not edited at least" above for a note's own edit date, independent of who it's linked to.
- **Structure** - whether a note's community (see below) is mostly gathered in one folder, or scattered across several. Flags a group of notes that clearly belongs together by links but has drifted across mismatched folders over time - the kind of thing that's easy to miss by browsing folders one at a time. Choose "linked notes scattered across folders" or "linked notes gathered in one folder."
- **Connectivity** - whether a note's connected component is the vault's single largest one (its "main body"), or one of the smaller pockets cut off from it. Choose "cut off from the vault's main body" or "in the vault's main body."
- **Community** - matches notes in one specific detected community, numbered by size (Community 1 is the largest present, Community 2 the next, and so on). Communities are groups of tightly-linked notes Clew detects automatically from your link graph - not folders or tags you set up yourself.

## Include or exclude

Most criteria show one small, clickable word right in their own controls - e.g. "Folder **is**" / "Folder **is not**", "Filename **contains**" / "**does not contain**", "**At least**" / "**less than**" this many days. Click the word to flip a criterion from including matches to excluding them, and back. The analytics criteria with a two-way choice (Bridging, Prominence, Activity, Structure, Connectivity) work the same way - the phrase itself is the toggle, since each one already reads as a complete either/or statement (there's no separate "high"/"low" number to set a cutoff on).

## Several filters at once

Enable more than one filter, and a note shows if it matches at least one of them by default - "Show if it matches: **At least one filter**", a dropdown above the filter list. Switch it to **"Every filter"** to require a note to satisfy *all* of the enabled filters instead (effectively AND-ing separate filters together).

Drag a filter's handle to reorder the list - purely for your own organization, since it has no effect on which notes are shown.

## When nothing matches

If an enabled filter (or combination) matches no notes, the graph shows a card explaining that, with a "Reset filter" button to disable every filter in one click.
