# What is Clew?

Obsidian's built-in graph shows you everything at once, but it's a single fixed view: one color scheme, one layout, and no easy way to narrow it down to just the notes you actually care about right now.

**Clew opens your whole vault as its own interactive graph view**, with a small set of tools layered on top:

- **Layout** - pick how notes are arranged: force-directed (the default), hierarchical, radial, or circular.
- **Filter** - hide everything except notes matching one or more named, reusable filters.
- **Color & size** - recolor and resize notes into named groups, by the same kind of criteria filters use.
- **Appearance** - tune node/edge size, color, physics, and labels live.

Nothing here edits your notes. Filters, groups, and appearance settings are all Clew's own saved state (per vault), completely separate from your note content.

## Why use it

- **Structure you can't see note-by-note becomes visible.** The default Force layout doesn't just draw dots - it pulls linked notes together and pushes unrelated ones apart, so topic clusters, well-connected hubs, and disconnected notes show up as shapes instead of something you have to click around to infer.
- **A big vault stops being one overwhelming mass.** Filters narrow the graph down to just the notes matching a tag, property, folder, or how recently they were touched, so you're looking at a slice, not everything at once.
- **Nothing you do here can break your vault.** Filters, groups, and appearance settings are saved state, not edits to your notes - experiment freely.

## What you can find out about your vault

- **Which notes are hubs.** Notes with more links are rendered larger by default, and a "link count" filter/group criterion lets you isolate them directly - the notes the rest of your vault actually depends on.
- **Which notes are orphaned or isolated.** With no links in or out, they get pushed to the outskirts by the Force layout on their own, with nothing pulling them in - an easy way to spot notes worth linking up or archiving.
- **Which topic areas have gone stale.** Color & size's "cluster freshness" criterion runs community detection on your link graph, then compares how recently each detected cluster was edited relative to the others - so, say, an old project's whole neighborhood of notes can get its own color without you having to define what "old project" means note by note.
- **Which individual notes haven't been touched in a while.** Filter or group by "not edited in the last N days," independent of which cluster a note belongs to.
- **How everything relates to one specific note.** The Radial layout arranges every other note in rings by hop distance from a note you pick - useful for seeing exactly what's actually connected to it, and how closely.

## Why "Clew"?

A *clew* is a ball of thread - the one Theseus used to find his way back out of the labyrinth. The name is a nod to what the plugin is for: giving you a thread through your vault's own tangle of links, instead of losing track of how everything connects.

## Where to go next

- [Getting started](./getting-started) - open the graph for the first time.
- [Layouts](./layouts), [Filter](./filter), [Color & size](./color-and-size), [Appearance](./appearance) - one page per panel, in the order their toolbar icons appear.
- [Interacting with the graph](./interactions) - clicking, hovering, and pinning notes.
