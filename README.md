# Clew

[![Version](https://img.shields.io/github/manifest-json/v/christian-luger-at/obsidian-clew?color=blue&label=version)](https://github.com/christian-luger-at/obsidian-clew/releases)
[![Obsidian minimum version](https://img.shields.io/badge/Obsidian-%E2%89%A5%201.0.0-7c3aed)](https://obsidian.md)
[![License: 0-BSD](https://img.shields.io/badge/license-0--BSD-blue)](LICENSE)
[![Build](https://github.com/christian-luger-at/obsidian-clew/actions/workflows/lint.yml/badge.svg)](https://github.com/christian-luger-at/obsidian-clew/actions/workflows/lint.yml)
[![GitHub issues](https://img.shields.io/github/issues/christian-luger-at/obsidian-clew)](../../issues)

Graph view for [Bases](https://help.obsidian.md/bases). Filter your vault into a graph, find the paths between two notes, and see which clusters have gone quiet.

A plugin for [Obsidian](https://obsidian.md).

> [!note]
> **Early development.** The repository is scaffolded and the release tooling is in place, but the graph view itself is still being built. Expect the feature list below to change.

## What it's for

Obsidian's built-in graph shows you everything at once. Clew starts from a **Base** instead: whatever set of notes your Base defines becomes the graph, so you look at one project, one area, or one tag at a time.

- **Filter your vault into a graph** - the Base is the query; the graph is the view.
- **Paths between two notes** - pick a start and an end and see how they actually connect.
- **Quiet clusters** - surface groups of notes that stopped being touched, so stale corners of the vault don't disappear.

## Installing the plugin

### From the Community Plugins browser

Not yet published to the community plugin list.

### Manual installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases).
2. Copy them into `<YourVault>/.obsidian/plugins/clew/`.
3. Reload Obsidian and enable **Clew** under **Settings → Community plugins**.

## Compatibility

- Requires an Obsidian version with **Bases** available.
- Works on desktop and mobile.

## Support

Found a bug or have a feature request? Please [open an issue](../../issues).

If Clew helps you, a ⭐ on the repo makes it easier for others to discover - thank you!

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report issues, set up the project, and open a pull request, and [DEVELOPMENT.md](DEVELOPMENT.md) for the local dev workflow and the release process.

Quick start:

```bash
nvm use        # activate the Node version from .nvmrc
npm install    # install dependencies
npm run dev    # compile src/main.ts to main.js in watch mode
npm run build  # type-check and produce a production build
npm run lint   # ESLint, incl. the Obsidian-specific ruleset
```

## API documentation

See https://docs.obsidian.md

## License

Clew is licensed under [0-BSD](LICENSE).
