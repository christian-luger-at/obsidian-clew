# Development

Clew's own development workflow (local setup, testing, the manual QA vault, the release process) lives outside this site, in the repo itself - see [CONTRIBUTING.md](https://github.com/christian-luger-at/obsidian-clew/blob/main/CONTRIBUTING.md) and [DEVELOPMENT.md](https://github.com/christian-luger-at/obsidian-clew/blob/main/DEVELOPMENT.md).

This page covers just the documentation site you're reading now.

## Running the site locally

```bash
npm run docs:dev      # dev server with hot reload
npm run docs:build    # production build to docs/.vitepress/dist
npm run docs:preview  # serve the production build locally
```

## Regenerating the screenshots

Every screenshot under `docs/public/screens/` is generated, not hand-captured - `scripts/screenshots.mjs` drives a real Obsidian instance over the Chrome DevTools Protocol (via Playwright), against a small curated vault, and captures each panel in both light and dark themes.

```bash
npm run docs:shots            # requires Obsidian to be closed
npm run docs:shots -- --quit  # quit a running Obsidian first
```

What it does, in order:

1. Builds `.screenshot-vault/` - a ~290-note "world history" demo vault (`scripts/gen-history-vault.mjs`, deliberately separate from the small hand-crafted one `npm run gen-test-vault` generates for QA), plus the built plugin and a couple of pre-configured filters/groups (including a real Community group) so every panel shows realistic content instead of an empty list.
2. Backs up your real `obsidian.json` and points it at that vault instead.
3. Launches Obsidian with remote debugging enabled and connects to it.
4. Opens the graph view wide, waits for Force layout to settle, and captures each motif (graph overview, layout picker, Filter panel, Color & size panel, Appearance panel, Diagnostics panel, Focus panel, Timeline panel, node hover) in light and dark.
5. Restores your real `obsidian.json` and quits the launched Obsidian.

Only macOS is supported (it launches `/Applications/Obsidian.app` directly) - re-run it whenever a UI change should be reflected in the screenshots, and commit the resulting PNGs under `docs/public/screens/` (they're deployed as static assets, not regenerated in CI - `docs/**` has no way to launch a real, licensed copy of Obsidian with a display).
