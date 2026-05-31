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

## Git & PR Guidelines

NEVER include Claude session links, tracking IDs, or platform attributions in commits or PR text. Keep all PR descriptions strictly focused on the code changes.
