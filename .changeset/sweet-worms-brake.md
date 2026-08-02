---
---

Downgrade the pending `major` bumps to `minor` so every package stays on a
`0.x` line. The breaking changes they describe are unchanged; only the semver
bump they request is.

Add `bun run versions:check` to CI so this cannot recur: it fails the build on
any package whose next version — projected from the pending changesets, or sitting
in package.json already — leaves `0.x`, and names the changeset files asking for
it. `ALLOW_MAJOR_RELEASE=1` is the escape hatch for the day 1.0 is deliberate.
