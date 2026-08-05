# Timeline

Click the **Timeline** toolbar icon (the clock-with-arrow) to replay your vault's notes and links in the order they were created.

<figure class="shot shot-narrow">
  <img class="doc-shot light-only" src="/screens/timeline-panel-light.png" alt="The Timeline panel, light theme">
  <img class="doc-shot dark-only" src="/screens/timeline-panel-dark.png" alt="The Timeline panel, dark theme">
  <figcaption>Play, scrubber, current date, duration, and pace mode.</figcaption>
</figure>

Opening it jumps the graph back to the very beginning - before your first note existed - ready to press Play. New notes and links grow in as they appear rather than just popping into place.

> **An approximation, not exact history.** Obsidian doesn't record *when* a link was actually added to a note, only each file's own creation time. A link shows up as soon as both its notes exist, which may be earlier than the link itself was actually drawn. Obsidian's own core Graph View has the same limitation.

## Controls

- **Play / Pause** - starts replaying from wherever the scrubber sits (or from the very beginning, if playback already finished).
- **Scrubber** - drag to jump straight to any point, without pressing Play.
- **Duration** - how long the *whole* replay takes: 10s, 30s, 1 min, or 3 min. Picking a duration doesn't change what's shown, only how fast playback moves through it.
- **Pace mode** - how that duration is spent:
  - **Real time** (the default) - playback maps proportionally onto your vault's actual date span, so the time you're spending watching corresponds to real elapsed history. A vault with a long quiet stretch followed by a burst of new notes will sit still for most of the replay, then reveal that burst near the end.
  - **Even pace** - playback instead advances one step per distinct creation moment, evenly spaced regardless of the calendar gap between them, so something visibly changes throughout the whole replay. Useful if "real time" pacing leaves your vault looking frozen for too long.

Both are legitimate depending on what your vault's own date spread looks like - there's no single right answer, so it's a setting rather than a fixed choice. Your last picks for duration and pace mode are remembered the next time you open Clew.

## Interaction with Filter

An active filter stays in effect while you scrub or play - the timeline only reveals notes that are both within the current cutoff *and* matching your filter, so replaying a filtered-down view doesn't quietly show everything else too. Scrub back to "today", or close the panel, to hand full control back to your filter.
