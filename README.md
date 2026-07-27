# Clew

[![Version](https://img.shields.io/github/manifest-json/v/christian-luger-at/obsidian-clew?color=blue&label=version)](https://github.com/christian-luger-at/obsidian-clew/releases)
[![Obsidian minimum version](https://img.shields.io/badge/Obsidian-%E2%89%A5%201.12.0-7c3aed)](https://obsidian.md)
[![License: 0-BSD](https://img.shields.io/badge/license-0--BSD-blue)](LICENSE)
[![Build](https://github.com/christian-luger-at/obsidian-clew/actions/workflows/lint.yml/badge.svg)](https://github.com/christian-luger-at/obsidian-clew/actions/workflows/lint.yml)
[![Coverage](https://raw.githubusercontent.com/christian-luger-at/obsidian-clew/badges/coverage.svg)](https://github.com/christian-luger-at/obsidian-clew/actions/workflows/coverage.yml)
[![GitHub issues](https://img.shields.io/github/issues/christian-luger-at/obsidian-clew)](../../issues)

See your whole vault as a graph, and find how any two notes actually connect - without every path routing through your index notes.

A plugin for [Obsidian](https://obsidian.md).

> [!note]
> **Early development.** The repository is scaffolded and the release tooling is in place, but the plugin itself is still being built. Expect the feature list below to change.

## What it's for

Obsidian's built-in graph shows you everything at once, but it can't answer "how are X and Y connected?" - and a naive answer to that question almost always routes through a hub note (an index, a MOC, a daily note), which is technically correct and practically useless.

- **See your whole vault as a graph** - open it from the ribbon icon or the **"Open graph"** command, no setup needed.
- **Find the path between two notes** - pick a start and an end; routing is weighted to avoid cutting through hub notes, with alternative routes shown alongside the best one.
- **Export a path to Canvas** - turn a found path into an editable `.canvas` file.

## Installing the plugin

### From the Community Plugins browser

Not yet published to the community plugin list.

### Manual installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases).
2. Copy them into `<YourVault>/.obsidian/plugins/clew/`.
3. Reload Obsidian and enable **Clew** under **Settings → Community plugins**.

## Compatibility

- Requires Obsidian **1.12.0** or later.
- Works on desktop. Mobile is declared supported (`isDesktopOnly: false`) but hasn't been verified on a tablet yet - see [DEVELOPMENT.md](DEVELOPMENT.md).

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
