# Getting started

## Install

See the [README](https://github.com/christian-luger-at/obsidian-clew#installing-the-plugin) for installation instructions - Clew isn't on the Community Plugins browser yet, so it's a manual install from the [latest release](https://github.com/christian-luger-at/obsidian-clew/releases) for now.

## Open the graph

Once the plugin is enabled, either:

- Click the **Clew** icon in the left ribbon, or
- Run **"Open graph view"** from the command palette (`Ctrl/Cmd+P`).

The graph builds itself from your vault immediately - every note is a node, every link an edge. No configuration is required to get a useful view.

<figure class="shot">
  <img class="doc-shot light-only" src="/screens/graph-overview-light.png" alt="The Clew graph view, light theme">
  <img class="doc-shot dark-only" src="/screens/graph-overview-dark.png" alt="The Clew graph view, dark theme">
  <figcaption>The graph view, opened with the default (Force) layout.</figcaption>
</figure>

## The toolbar

A vertical icon rail sits in the top-right corner of the graph:

| Icon | Opens |
| --- | --- |
| Layout | The [layout picker](./layouts) |
| Reset view | Re-fits the camera to the whole graph |
| Filter | The [Filter](./filter) panel |
| Color & size | The [Color & size](./color-and-size) panel |
| Appearance | The [Appearance](./appearance) panel |

Only one of Filter, Color & size, and Appearance is ever open at a time - opening one closes whichever of the other two was open.

## Everything else is optional

The rest of this guide covers each panel in turn, but none of it is required - the graph is fully usable the moment you open it. Filters and groups you set up are saved per vault and keep applying the next time you open Obsidian.
