# Find path

Click the **Find path** toolbar icon (the route icon) to find a route through the link graph between any two notes.

## Using it

1. Click the Find path icon to open the panel.
2. Pick a **From** note and a **To** note.
3. Optionally turn on **Directed** - off (the default) lets a route follow a link either way regardless of which note it was written in; on restricts it to the actual direction a link was written, so a route can only go from the linking note to the linked one, not back.
4. Click **Find path**.

Clew favors notes with fewer links over big hub/index notes even if that route ends up with more hops - a path that hops through your vault's biggest MOC just because it links to everything usually isn't the *meaningful* connection you're looking for. Alongside the shortest route, a few alternatives are shown as small pills you can switch between; the graph highlights whichever one is currently selected and dims everything else, the same way a Diagnostics highlight does.

**"No path found" is a real, useful result, not an error** - it means the two notes genuinely aren't connected through any chain of links in either direction. See the [FAQ](../reference/faq#find-path-says-no-path-found-is-that-a-bug) for more on this.

## Excluding notes and folders

Some notes shouldn't count as a route through your vault - a single all-encompassing MOC/index note, or a whole "Archive" folder, would otherwise turn up as the "connection" between almost anything. Configure a vault-wide exclusion list under **Settings → Community plugins → Clew → "Find path"**: pick individual notes, or whole folders (including subfolders). Excluded notes also get a visible ring while Find path is open, so you can see which ones are being skipped at a glance. This is settings-tab-only, not something you set per search in the Find path panel itself - one exclusion list applies everywhere Find path runs.

## Clearing a result

Click the "x" on the result panel to clear the highlight and show the whole graph again. Find path's result is exclusive with Focus, an enabled filter's hiding, and a Diagnostics highlight - only one of these overrides the graph's normal contents at a time.
