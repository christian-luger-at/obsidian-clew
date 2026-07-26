# Clew Development Guide

This document explains how to activate code changes automatically in the plugin inside [Obsidian](https://obsidian.md).

## Prerequisites

### Node.js with nvm

This project uses **nvm** (Node Version Manager). Make sure you have nvm installed. The Node version is pinned in `.nvmrc`.

### 1. Create a test vault

If you do not already have a test vault, create one now (or open your existing test vault):

#### Option A: Using the Obsidian UI

1. Open Obsidian
2. Click the vault icon in the top left
3. Choose **Create new vault**
4. Enter a name (for example, "Plugin Test")
5. Choose a location (for example, `~/dev/obsidian-clew-vault/Plugin-Test`)
6. Click **Create**

#### Option B: Manual (existing vault)

If your test vault already exists, skip this step.

> [!tip]
> Clew is a graph view, so a nearly empty vault shows you almost nothing. Point it at a vault with a few hundred interlinked notes - or your real vault, opened read-only in a copy - to see whether filtering, path-finding, and cluster detection actually behave.

### 2. Link the plugin to Obsidian (symlink)

Create the plugin folder and add a symlink to the vault's plugin directory:

```bash
mkdir -p ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins

ln -s ~/dev/obsidian-clew ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins/clew
```

Verify that the symlink was created correctly:

```bash
ls -la ~/dev/obsidian-clew-vault/Plugin-Test/.obsidian/plugins/clew
```

You should see something like this (macOS usually shows the full target path):

```bash
clew -> /Users/christian/dev/obsidian-clew
```

> [!tip]
> It is normal for `ls -la` to show the full path `/Users/...` - this is not a misconfiguration.

> [!important]
> The symlink name must match the `id` in `manifest.json` (`clew`), not the repository name.

### 3. Install project dependencies (important)

Make sure the correct Node version is active and install dependencies:

```bash
nvm use # activate the Node version defined in .nvmrc
npm install # install all dependencies (esbuild, typescript, ...)
```

> [!important]
> `npm run dev` will fail if you do not run `npm install` first.

### 4. Start the development server (watch mode)

Now start the dev server (esbuild in watch mode):

```bash
nvm use
npm run dev
```

> [!tip]
> You can start the dev server before opening the vault; however, it is recommended to create the vault and symlink first so Obsidian loads the correct `main.js`.

This starts **esbuild in watch mode**, which automatically bundles your TypeScript files into `main.js` whenever you save.

### 5. Load the plugin in Obsidian

1. Open Obsidian with your test vault (if it is not already open)
2. Go to **Settings → Community plugins → Installed plugins**
3. Enable the "Clew" plugin if it is disabled

### 6. Reload the plugin after code changes

After every change:

1. Save the file (Cmd+S)
2. Wait about 1-2 seconds for `npm run dev` to bundle the new `main.js`
3. Open the **Command Palette** with Cmd+P
4. Type `Reload` and choose **Reload plugins**

That's it! Your updated plugin is now active.

## Folder structure

```bash
src/
  main.ts            # plugin entry point and lifecycle management
  settings.ts        # settings interface, defaults, SettingTab UI
```

As the plugin grows, keep `main.ts` limited to lifecycle (load/unload, registering
commands and views) and split features into their own modules - see the conventions
and the example layout in [AGENTS.md](AGENTS.md).

## Build commands

| Command | Description |
| --- | --- |
| `npm run dev` | Watch mode for development (esbuild recompiles on changes) |
| `npm run build` | Production build with TypeScript type check and minification |
| `npm run lint` | Run ESLint with Obsidian-specific rules |
| `npm run release` | Build and stage a release into `releases/v<version>/` (local only) |
| `npm run release:publish` | Same, then tag, push, and publish the GitHub release |
| `npm run release:patch` \| `:minor` \| `:major` | Bump the version, build, and publish in one command |

## Testing

There is no automated test suite yet. Verify changes manually in a test vault
(see the setup above), and run `npm run lint` and `npm run build` before pushing -
CI runs both on every branch.

If you add tests, [Vitest](https://vitest.dev) is the natural fit: Obsidian is not
available in a Node environment, so it needs a minimal stub module aliased in the
Vitest config. Wire the new script into `package.json`, add it to `release.sh`
before the build step, and update this section plus [CONTRIBUTING.md](CONTRIBUTING.md).

## Build production release

### 1. Bump the version

The version number lives in three places: `package.json`, `manifest.json`, and `versions.json`. You can bump it automatically or manually.

#### Option A - automated (`--bump`)

Pass `--bump patch|minor|major` to the release script (or use the matching npm shortcut). This runs `npm version <type>`, which bumps `package.json` and - via the existing `version-bump.mjs` hook - keeps `manifest.json` and `versions.json` in sync, then commits the result as `chore: bump version to vX.Y.Z`:

```bash
bash release.sh --bump patch   # 1.0.1 → 1.0.2 - bug fixes
bash release.sh --bump minor   # 1.0.1 → 1.1.0 - new features, backwards compatible
bash release.sh --bump major   # 1.0.1 → 2.0.0 - breaking changes
```

This requires a clean working tree (commit or stash any pending changes first). The script then continues straight into building (step 2). Combine with `--publish` (or use the `release:patch` / `release:minor` / `release:major` npm scripts below) to bump, build, and publish in one command.

#### Option B - manual

Update `manifest.json` and `package.json` by hand, then commit:

```bash
# Edit version in manifest.json and package.json (e.g. 1.0.0 → 1.1.0)
git add manifest.json package.json
git commit -m "chore: bump version to 1.1.0"
git push
```

### 2. Build and package

Run the release script - it builds the production bundle and copies the three required files into `releases/v<version>/`:

```bash
npm run release
```

Output: `releases/v1.1.0/` containing `main.js`, `manifest.json`, `styles.css`.

### 3. Create a GitHub release

You have two options:

#### Option A - automated (`--publish`)

The release script can also tag, push, and publish the GitHub release for you. This is **optional**: omit `--publish` (or just run `npm run release`) to build locally only.

```bash
npm run release:publish
# equivalent to: bash release.sh --publish

# override the auto-generated notes with your own text:
bash release.sh --publish --notes "Adds path-finding between two notes"
```

**Release notes are generated automatically** from the [Conventional Commits](https://www.conventionalcommits.org/) since the previous tag: `feat:` commits become **Features**, `fix:` commits become **Fixes**, and non-conventional subjects go under **Other** (noise like `chore:` / `ci:` / `test:` / `docs:` is dropped). The script prints a preview before the publish confirmation. Pass `--notes "…"` to override.

To bump the version, build, and publish in a single command, use the combined shortcuts (these chain `--bump <type> --publish`):

```bash
npm run release:patch   # bug fixes
npm run release:minor   # new features
npm run release:major   # breaking changes
```

Before publishing, the script checks that:

- the [GitHub CLI](https://cli.github.com/) (`gh`) is installed and authenticated (`gh auth login`)
- the working tree is clean (the version-bump commit from step 1 must already be in place)
- the tag `<version>` doesn't already exist

It then asks for confirmation (`Publish X.Y.Z to GitHub? [y/N]`) before pushing the tag and creating the release - nothing is pushed without that confirmation, even with `--publish` set.

The release is published directly (not as a draft) with the locally built assets. Publishing fires the "release" event the `Attest release build` workflow needs; it then rebuilds `main.js` in CI, generates a signed build-provenance attestation for all three assets, and re-uploads them - so within about 30 seconds the public release carries CI-built, attested assets rather than the locally-built ones. Verify any asset with `gh attestation verify main.js --repo christian-luger-at/obsidian-clew`.

> [!note]
> Attestation is optional for the community store, but it has a history of tripping up Obsidian's automated review: in July 2026 valid attestations were rejected as cryptographically invalid because GitHub's attestation API had changed its response format (`bundle` → `bundle_url`) and the review scanner hadn't caught up. Several plugins were delisted before an Obsidian moderator confirmed and fixed it. If a review ever flags the attestation, check the Obsidian forum before assuming `attest.yml` is at fault.

> [!important]
> The release tag must match the `version` in `manifest.json` **exactly, without a `v` prefix** (e.g. `1.1.0`, not `v1.1.0`). Obsidian's community-plugin store and the in-app auto-updater only recognise releases tagged this way. `release.sh` already tags without the prefix.

#### Option B - manual

```bash
# Create a git tag that exactly matches the manifest version - no "v" prefix
git tag 1.0.0
git push origin 1.0.0

# Create the GitHub release and attach the three plugin files
gh release create 1.0.0 \
  releases/v1.0.0/main.js \
  releases/v1.0.0/manifest.json \
  releases/v1.0.0/styles.css \
  --title "1.0.0" \
  --notes "Initial release"
```

Either way, the release is now visible on GitHub with the three files as downloadable artifacts.

> [!tip]
> To install the release in Obsidian manually: download all three files and place them in `.obsidian/plugins/clew/` inside your vault.

## Download statistics

Once the plugin is in the community store, `scripts/release-stats.sh` prints
per-version download counts from both sources - the Obsidian store and the GitHub
release assets (manual and BRAT installs):

```bash
./scripts/release-stats.sh
```

It needs `jq`. Export `GITHUB_TOKEN` to avoid the GitHub API rate limit.

## Submit the plugin to the Obsidian Community store

Getting the plugin into the in-app **Community Plugins** browser is a **one-time** pull request against Obsidian's registry. The store serves the very same GitHub release artifacts, so a single correctly-tagged release (see step 3 above - tag **without** the `v` prefix) covers both manual installs and the store.

### Before you submit - checklist

Submissions are checked by an automated bot **and** a human reviewer. Make sure:

- **`manifest.json`** sits in the repo root with a unique `id` (lowercase, hyphenated, no spaces, and must not contain `obsidian` or `plugin`), a `name` that doesn't start with "Obsidian", a concise `description` that doesn't start with the plugin name, plus `author`, `minAppVersion`, and `isDesktopOnly`.
- **`minAppVersion`** is accurate. Clew builds on **Bases**, so it must not claim support for Obsidian versions that predate the APIs it uses.
- **`versions.json`** maps each released plugin version to its minimum Obsidian version.
- A **`LICENSE`** file and a **`README.md`** (what it does + how to use it) exist.
- No leftover sample-plugin code, no `console.log`, no obfuscated code - the source is public and reviewable.
- A **GitHub release** exists whose **tag equals the `manifest.json` version exactly, with no `v` prefix** (e.g. `1.0.0`), with `main.js`, `manifest.json`, and `styles.css` attached as assets.

Run `npm run lint` and `npm run build`, then cut the release with `npm run release:publish` (or `release:patch` / `release:minor` / `release:major`).

### First-time submission (one-off)

1. Cut the release (above) so the tag and the three assets exist.
2. Fork [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) and append your plugin to the **end** of `community-plugins.json`:

   ```json
   {
     "id": "clew",
     "name": "Clew",
     "author": "Christian Luger",
     "description": "Graph view for Bases. Filter your vault into a graph, find the paths between two notes, and see which clusters have gone quiet.",
     "repo": "christian-luger-at/obsidian-clew"
   }
   ```

   - `repo` is the `user/repo` slug - **not** a full URL.
   - Keep the JSON valid and don't reorder existing entries.
3. Open a **pull request** to `obsidianmd/obsidian-releases` and fill in the PR template (it asks you to confirm the checklist).
4. The **automated bot** validates the repo and release - fix anything it flags. Then a **maintainer reviews the code manually**; depending on the queue this can take days to a few weeks.
5. Once the PR is merged, the plugin shows up in **Settings → Community plugins → Browse** for everyone.

### Ongoing updates (after acceptance)

No further PR is ever needed. For each update:

1. Bump `manifest.json` **and** `versions.json` (the `--bump` flag does both).
2. Cut a new release tagged with the exact new version, no `v` prefix, with the three assets - e.g. `npm run release:patch` / `release:minor` / `release:major`.
3. Obsidian clients detect the new release automatically and offer the update.

> [!important]
> The plugin `id` is **permanent** once accepted - changing it later breaks users' saved settings and the update path. Double-check `id` (and that it's unique in `community-plugins.json`) before submitting.

## Additional resources

- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Obsidian API Docs](https://docs.obsidian.md)
- [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Submit your plugin (official guide)](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Community plugins registry (`obsidian-releases`)](https://github.com/obsidianmd/obsidian-releases)
