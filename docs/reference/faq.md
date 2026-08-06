# FAQ & troubleshooting

## Does Clew change my notes?

No. Filters, Color & size groups, appearance settings, and pinned positions are all Clew's own saved state for the vault - separate from your note content, and never written into your notes' frontmatter or body.

## Nothing shows in the graph

Two possible reasons, and Clew tells you which:

- **The vault has no notes at all** - the graph shows a card saying so.
- **An active filter matches nothing** - the graph shows a different card, with a "Reset filter" button. See [Filter](../guide/filter).

## A note isn't where I left it

If you dragged it to pin it, switching layouts and back to Force should restore it - pinning only applies in Force layout (see [Interacting with the graph](../guide/interactions)). If it's still not where you expect, check the [Appearance panel](../guide/appearance)'s "Pinned node positions" - "Clear all" resets every pin, in case one was pinned unintentionally.

## Why does the Timeline jump or sit still?

It depends on the pace mode you picked (see [Timeline](../guide/timeline)). "Real time" maps playback onto your vault's actual date span, so a long quiet stretch in your notes' history means playback sits still for a while too, before a burst of newer notes appears quickly. "Even pace" instead advances evenly no matter how far apart notes were actually created, so something is always visibly happening - at the cost of the date shown sometimes jumping a lot between two ticks. Neither is wrong; pick whichever reads better for your vault.

## "Find path" says no path found - is that a bug?

No - it means the two notes genuinely aren't connected through any chain of links, in either direction. That's a real, useful result on its own (e.g. two completely separate topic areas that have never referenced each other), not an error.

## Is my vault too big for this?

Force layout scales to large vaults (it switches to an approximate physics algorithm above a node-count threshold). Hierarchical layout doesn't scale the same way and disables itself above a note-count threshold - the [layout picker](../guide/layouts) shows this directly on its row when it applies.

## I found a bug / have a feature request

Please [open an issue](https://github.com/christian-luger-at/obsidian-clew/issues) - see the [README](https://github.com/christian-luger-at/obsidian-clew#support) for details.
