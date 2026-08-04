# Filter

Click the **Filter** toolbar icon to open the Filter panel - a list of named, reusable filters you create yourself. With none enabled, every note shows; enabling one or more hides every note that doesn't match.

<figure class="shot shot-narrow">
  <img class="doc-shot light-only" src="/screens/filter-panel-light.png" alt="The Filter panel with two filters set up, light theme">
  <img class="doc-shot dark-only" src="/screens/filter-panel-dark.png" alt="The Filter panel with two filters set up, dark theme">
  <figcaption>Two saved filters - one enabled, one not.</figcaption>
</figure>

## Creating a filter

Click **"+ new filter"** to add one, then click its pencil icon to edit it. Give it a name, then click **"+ add"** to add criteria to it:

- **Text** - the note's title or body contains a word or phrase.
- **Tag**
- **Property** - a frontmatter value, compared with `contains`/`equals`/`does not equal`/`is empty`/`is not empty`.
- **Folder** - includes subfolders.
- **Filename**
- **Not edited at least (days)**
- **Activity** - whether the note sits in an active or inactive neighborhood of the vault (based on how recently tightly-linked notes around it were edited overall).
- **Minimum number of links**

A note matches a filter only if it satisfies **every** criterion in that filter.

## Include or exclude

Most criteria show one small, clickable word right in their own controls - e.g. "Folder **is**" / "Folder **is not**", "Filename **contains**" / "**does not contain**", "**At least**" / "**less than**" this many days. Click the word to flip a criterion from including matches to excluding them, and back.

## Several filters at once

Enable more than one filter, and a note shows if it matches at least one of them by default - "Show if it matches: **At least one filter**", a dropdown above the filter list. Switch it to **"Every filter"** to require a note to satisfy *all* of the enabled filters instead (effectively AND-ing separate filters together).

Drag a filter's handle to reorder the list - purely for your own organization, since it has no effect on which notes are shown.

## When nothing matches

If an enabled filter (or combination) matches no notes, the graph shows a card explaining that, with a "Reset filter" button to disable every filter in one click.
