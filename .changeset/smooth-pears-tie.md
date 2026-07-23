---
---

Add a repository-root `CHANGELOG.md` that aggregates every release across the
monorepo (newest first), and a `scripts/update-root-changelog.ts` that the
release workflow runs after `changeset version` to append each new release from
the per-package changelogs.
