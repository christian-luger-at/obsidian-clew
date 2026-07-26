# Security Policy

Clew is a source-available Obsidian plugin maintained by a single person. It runs
entirely inside Obsidian on your own device: it reads the notes, links, and Bases
definitions in your vault and renders them as a graph. It has no backend, sends no
telemetry, and makes no network requests of its own. Security reports are still
very welcome.

## Supported versions

Only the latest released version receives security fixes. Please reproduce any
issue on the current release before reporting it.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub: go to the
[Security tab](https://github.com/christian-luger-at/obsidian-clew/security)
of the repository and choose **Report a vulnerability**. This opens a private
advisory that only you and the maintainer can see until a fix is available.

To help triage, please include where practical:

- The plugin version and your Obsidian version and platform (desktop or mobile).
- A description of the issue and its impact.
- Steps to reproduce, ideally with a minimal note, link structure, or Base
  definition.
- Any proof-of-concept, logs, or screenshots.

## What to expect

As a single-maintainer project, response times are best-effort:

- **Acknowledgement:** within 5 business days.
- **Assessment and triage:** within 10 business days of acknowledgement.
- **Fix:** valid, in-scope issues are addressed as quickly as is practical and
  released in a patch version. You will be credited in the release notes unless
  you prefer to stay anonymous.

Please practice coordinated disclosure: give a reasonable window to ship a fix
before disclosing the issue publicly.

## Scope

Because the plugin runs locally against your own vault, the security-relevant
surface is small. Examples of **in-scope** reports:

- Writing to or deleting files outside the vault, or unexpected mutation of notes
  the user did not act on (path traversal, data loss or corruption).
- Executing arbitrary code or commands as a result of rendering a crafted note,
  link, frontmatter value, or Base definition - including anything injected into
  the graph as a node label or tooltip.
- Leaking vault contents off the device (any unexpected network activity).
- Denial of service that is reachable from vault content rather than vault size -
  for example a crafted link structure that hangs Obsidian regardless of how small
  the vault is.

Examples of **out of scope** reports:

- Vulnerabilities in Obsidian itself, in Bases, or in any other third-party plugin
  or dependency. Report those to the respective project. If a dependency advisory
  affects this plugin, a Dependabot alert or an issue is enough.
- Issues that require an already-compromised device, a malicious Obsidian plugin,
  or physical access.
- Social engineering, and problems in your own vault content or configuration.
- Slow rendering on very large vaults - that is a performance issue, please open a
  normal issue for it.
- Missing hardening that has no demonstrated impact (best-practice suggestions
  are welcome as normal issues, not security reports).

## No bug bounty

There is no paid bug-bounty program. Credit in the release notes is offered as
thanks for responsible disclosure.
