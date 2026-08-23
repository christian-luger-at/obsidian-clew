# Contributing to Clew

Thanks for taking the time to contribute. This guide explains how to report
issues, propose changes, and get a pull request merged.

> [!important]
> **Licensing note.** Clew is licensed under [MIT](LICENSE). By submitting a
> contribution (issue, code, or documentation) you agree that your contribution
> is provided under the same license.

## Ways to contribute

- **Report a bug** - open an [issue](https://github.com/christian-luger-at/obsidian-clew/issues).
- **Request a feature** - open an issue describing the problem you want solved.
- **Improve the docs** - fixes to the README, DEVELOPMENT.md, or in-code docs are welcome.
- **Send code** - bug fixes and small, well-scoped features via pull request.

For anything larger than a small fix, please **open an issue first** so we can
agree on the approach before you invest time. This avoids PRs that have to be
rejected for scope or design reasons.

## Reporting bugs

A good bug report includes:

1. **What you did** - the steps to reproduce.
2. **What you expected** to happen.
3. **What actually happened** (screenshots or a short screen recording help a lot).
4. **Environment** - Obsidian version, operating system (or mobile platform), and
   Clew version.
5. A **minimal example** - the smallest Base, filter, or set of notes that triggers
   the problem. Vault size and link density matter for a graph view, so mention
   them if the issue looks performance-related.

## Development setup

The full setup (test vault, symlink, watch mode, reloading the plugin) is
documented in **[DEVELOPMENT.md](DEVELOPMENT.md)**. In short:

```bash
nvm use          # activate the Node version from .nvmrc
npm install      # install dependencies
npm run dev      # start esbuild in watch mode
```

## Before you open a pull request

Run both checks locally - CI runs the same ones and a red build will block
the merge:

```bash
npm run lint     # eslint (incl. eslint-plugin-obsidianmd rules) + unit tests
npm run build    # unit tests + type-check + production bundle
```

Both `lint` and `build` already run the unit test suite (`npm run test`), so a
red test is a red build either way. If you touch anything perf-sensitive
(graph construction, community detection, pathfinding, layout), also run
`npm run test:perf` - it's not part of the default gate (see
[DEVELOPMENT.md](DEVELOPMENT.md#testing) for why), so it won't be caught
otherwise. For a change to `src/graph/`, adding or updating a test there is
expected, not optional - see DEVELOPMENT.md's Testing section for the
patterns (`test/fakeApp.ts` for anything touching Obsidian's API). Please
still describe in the PR **how you verified the change** in a real vault
(the generated `test-vault/` - see [TESTING.md](TESTING.md) - covers most
functional edge cases) for anything a unit test can't reach, like actual
rendering.

## Coding guidelines

- **TypeScript, strict mode.** Match the style of the surrounding code - naming,
  comment density, and idioms.
- **No custom styling where an Obsidian native class or design token exists.** The
  view should be built from standard Obsidian classes and CSS variables on purpose,
  so it follows the user's theme.
- **Respect the Obsidian API guidelines** enforced by `eslint-plugin-obsidianmd`
  (sentence-case UI text, no forbidden Node.js imports in plugin code, command IDs
  must not repeat the plugin ID, etc.). `npm run lint` will tell you.
- **Keep `main.ts` small.** Lifecycle only; feature logic belongs in its own module
  under `src/`. See the conventions in [AGENTS.md](AGENTS.md).
- **Keep changes focused.** One logical change per pull request. Unrelated cleanups
  belong in their own PR.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
The release script generates the changelog from them, so the prefix matters:

- `feat:` - a new user-facing feature (→ **Features** in the release notes)
- `fix:` - a bug fix (→ **Fixes**)
- `chore:`, `ci:`, `test:`, `docs:`, `style:`, `build:`, `refactor:`, `perf:` -
  housekeeping; these are omitted from the generated release notes

Example:

```
fix(graph): keep node positions stable when a filter is cleared
```

Use an optional scope in parentheses (`feat(view): ...`) to point at the affected
area.

## Pull request checklist

- [ ] There is a related issue (for anything beyond a trivial fix).
- [ ] `npm run lint` and `npm run build` both pass.
- [ ] The PR describes how the change was verified in a vault.
- [ ] Commits follow Conventional Commits.
- [ ] The PR description explains **what** changed and **why**.

## Releases

Releases are cut by the author with `release.sh` (see the
[release section in DEVELOPMENT.md](DEVELOPMENT.md#release)). Contributors do not
need to bump versions or create tags - please leave `manifest.json`,
`package.json`, and `versions.json` version numbers unchanged in your PR.

## Questions

Not sure about something? Open an issue with the **question** label. Thanks for
helping make Clew better.
