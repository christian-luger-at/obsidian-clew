# Clew

Graph view for Bases. Filter your vault into a graph, find the paths between two notes, and see which clusters have gone quiet.

A plugin for [Obsidian](https://obsidian.md).

## Installation

### Community plugins

Not yet published to the community plugin list.

### Manual

Copy `main.js`, `styles.css` and `manifest.json` into `VaultFolder/.obsidian/plugins/clew/`, then enable the plugin in Obsidian's settings.

## Development

Requires Node.js v18 or newer.

```bash
npm i          # install dependencies
npm run dev    # compile src/main.ts to main.js in watch mode
npm run build  # type-check and produce a production build
npm run lint   # ESLint, incl. the Obsidian-specific ruleset
```

For local development, clone the repo directly into `VaultFolder/.obsidian/plugins/clew/` and reload Obsidian to pick up changes.

## Releasing

- Update `minAppVersion` in `manifest.json` if needed, then run `npm version patch | minor | major`. This bumps `manifest.json` and `package.json` and adds the entry to `versions.json`.
- Push the tag. The GitHub Action in `.github/workflows/release.yml` builds the plugin and creates a draft release with `main.js`, `manifest.json` and `styles.css` attached.
- Review and publish the draft release.

## API documentation

See https://docs.obsidian.md

## License

0-BSD — see [LICENSE](LICENSE).
