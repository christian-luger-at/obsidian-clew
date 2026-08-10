# Color & size

Click the **Color & size** toolbar icon to color and resize notes into named groups - the same criteria [Filter](./filter) uses, applied to change how matching notes look instead of hiding non-matches.

<figure class="shot shot-narrow">
  <img class="doc-shot light-only" src="/screens/color-and-size-panel-light.png" alt="The Color & size panel with two groups set up, light theme">
  <img class="doc-shot dark-only" src="/screens/color-and-size-panel-dark.png" alt="The Color & size panel with two groups set up, dark theme">
  <figcaption>Two node groups, each with its own color.</figcaption>
</figure>

## Creating a group

Click **"+ new group"**, pick a color, give it a name, and add criteria the same way as [Filter](./filter): Text, Tag, Property, Folder, Filename, Not edited at least, Minimum number of links, Existence, plus the analytics criteria - Bridging, Prominence, Activity, Structure, Connectivity, Community - each with its own include/exclude word. See [Filter's criteria section](./filter#the-criteria) for exactly what each one matches.

A note matches a group only if it satisfies **every** criterion in that group - same AND-only rule as Filter.

Optionally turn on **"Scale size"** to also multiply matching notes' size (on top of their normal link-count-based size, not replacing it - a highly-linked note in a group still reads as a hub).

## Color by community, automatically

Pick the **Community** criterion and Clew syncs the group's own color to that community's color from a fixed palette automatically - so "color each detected community differently" needs no manual color-picking, just one group per community.

## When several groups match the same note

Groups have a priority order - drag a group's handle to reorder the list. The **first** enabled group (in that order) whose criteria a note matches wins; a note can only be one color, so this is what decides ties. Order-across-groups is effectively "OR" for free: create a second group with different criteria and a different color to color two different kinds of notes at once.

A group with no criteria yet - or a note that matches no enabled group at all - falls back to the graph's default color and size.
