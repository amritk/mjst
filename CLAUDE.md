# Project rules

Developer guidelines live in the `.claude/` directory:

- **bun.md** — Bun runtime, APIs, testing, frontend
- **typescript.md** — TypeScript style, principles, naming
- **comments.md** — Comment guidelines and JSDoc
- **testing.md** — Test setup, style, and examples
- **architecture.md** — Monorepo structure and design

## Changesets

Add a changeset with every PR. Run `bunx changeset`, pick the affected
packages and an appropriate semver bump, and commit the generated file under
`.changeset/`. For changes that don't touch any published package (docs,
tooling, CI), create an empty changeset (`bunx changeset --empty`) so the PR
still records intent. The release workflow turns merged changesets into a
version PR and npm publish on merge to `main`.

Never pick `major`. Every package stays on the `0.x` line, and changesets
resolves a `major` on a `0.x` package to `1.0.0` rather than `0.(x+1).0` — so a
single one silently takes a package to 1.0. A breaking change gets `minor`; say
what breaks in the summary, which is where consumers read it anyway. CI runs
`bun run versions:check` to enforce this. Going 1.0 is a deliberate decision, not
something a PR does on the way past; when it is time, run the release with
`ALLOW_MAJOR_RELEASE=1`.

## Git & PR Guidelines

NEVER include Claude session links, tracking IDs, or platform attributions in commits or PR text. Keep all PR descriptions strictly focused on the code changes.
