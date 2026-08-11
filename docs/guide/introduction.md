# What is Clew?

Obsidian's built-in graph shows you everything at once, but it's a single fixed view: one color scheme, one layout, and no analysis beyond what you can eyeball.

**Clew is a Knowledge Explorer for your vault, not just another way to draw the graph.** It opens your whole vault as its own interactive graph view, but underneath that it runs real graph analytics - betweenness centrality, PageRank, community detection, connected components, even a local text-embedding model for notes that are related in *meaning* but never actually link to each other - and lets you filter, color, and size notes by what they find. A small set of tools sits on top of all that:

- **Layout** - pick how notes are arranged: force-directed (the default), hierarchical, radial, or circular.
- **Filter** - hide everything except notes matching one or more named, reusable filters, including the analytics criteria below.
- **Color & size** - recolor and resize notes into named groups, by the same kind of criteria filters use.
- **Find path** - the shortest route through the link graph between any two notes, with alternatives.
- **Focus** - narrow the whole graph down to one note and its neighborhood, hops away, with everything else hidden.
- **Timeline** - replay your notes and links in the order they were created.
- **Appearance** - tune node/edge size, color, physics, and labels live.
- **Diagnostics** - a panel of structural problems (orphans, broken links, isolated clusters, communities scattered across mismatched folders), each one click from being highlighted on the graph.
- **Views** - save the filter/group/layout/Focus combination you're currently looking at as one named, one-click-reapplicable view.

Nothing here edits your notes. Filters, groups, saved views, and appearance settings are all Clew's own saved state (per vault), completely separate from your note content.

## Why use it

- **Structure you can't see note-by-note becomes visible.** The default Force layout doesn't just draw dots - it pulls linked notes together and pushes unrelated ones apart, so topic clusters, well-connected hubs, and disconnected notes show up as shapes instead of something you have to click around to infer.
- **Analysis you'd otherwise have to eyeball gets computed for you.** Which notes structurally bridge two topic areas, which are prominent because prominent notes link to them, which communities of linked notes have gone stale or drifted across mismatched folders, which notes are about the same thing even though nothing links them - Clew runs the actual algorithms instead of asking you to guess from node size and color alone.
- **A big vault stops being one overwhelming mass.** Filters narrow the graph down to just the notes matching a tag, property, folder, edit recency, or any of the analytics criteria above, so you're looking at a slice, not everything at once.
- **Nothing you do here can break your vault.** Filters, groups, and appearance settings are saved state, not edits to your notes - experiment freely.

## What you can find out about your vault

- **Which notes are hubs.** Notes with more links are rendered larger by default, and a "Minimum number of links" filter/group criterion lets you isolate them directly - the notes the rest of your vault actually depends on.
- **Which notes bridge otherwise-separate parts of your vault, or are structurally prominent.** The **Bridging** criterion (betweenness centrality) finds notes that sit on the path between two topic areas; **Prominence** (PageRank) finds notes that are well-connected *because* the notes linking to them are well-connected too, not just because they have many links.
- **Which notes are orphaned, isolated, or cut off from the vault's main body.** The Diagnostics panel lists orphaned notes and disconnected clusters directly, with a one-click glow on the graph showing exactly which notes they are; the **Connectivity** filter/group criterion does the same thing note-by-note, for building it into a filter or color group.
- **Which groups of linked notes exist, and which have gone stale or drifted across folders.** Clew runs community detection (the Louvain algorithm) on your link graph automatically - the **Community** criterion matches everything in one specific detected group. **Activity** compares how recently each community was edited relative to the others; **Structure** compares each community against your folder layout instead, flagging one that clearly belongs together by links but lives scattered across five different folders. All three surface in the Diagnostics panel too - see [Filter](./filter#understanding-community-the-hardest-one-to-explain) for a fuller explanation of Community, since it's the one criterion that trips people up most.
- **Which notes are about the same thing, even if nothing links them.** **Semantic clustering** reads every note's own title and content and groups notes by meaning, computed locally on your device - the one criterion here that isn't about link structure at all. Two notes that both happen to discuss the same topic, written independently and never cross-referenced, land in the same cluster.
- **Which individual notes haven't been touched in a while.** Filter or group by "not edited in the last N days," independent of which community a note belongs to.
- **How everything relates to one specific note.** The Radial layout arranges every other note in rings by hop distance from a note you pick - useful for seeing exactly what's actually connected to it, and how closely. Focus goes further and hides everything past a chosen hop distance entirely. Find path shows the actual route (or routes) between two specific notes.
- **How your vault grew.** The Timeline panel replays notes and links in creation order - useful for spotting a burst of activity, a long quiet stretch, or just how far back your oldest notes go.

## Why "Clew"?

A *clew* is a ball of thread - the one Theseus used to find his way back out of the labyrinth. The name is a nod to what the plugin is for: giving you a thread through your vault's own tangle of links, instead of losing track of how everything connects.

## Where to go next

- [Getting started](./getting-started) - open the graph for the first time.
- [Layouts](./layouts), [Filter](./filter), [Color & size](./color-and-size), [Find path](./find-path), [Focus](./focus), [Timeline](./timeline), [Appearance](./appearance), [Diagnostics](./diagnostics), [Saved views](./saved-views) - one page per panel, in the order their toolbar icons appear.
- [Interacting with the graph](./interactions) - clicking, hovering, and pinning notes.
