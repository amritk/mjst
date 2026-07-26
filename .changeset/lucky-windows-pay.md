---
---

CI: fix and harden the release workflow.

- Pin npm to 11. npm 12 wraps `npm info --json` in an array, which defeats
  changesets' "already published?" pre-check and makes `changeset publish`
  attempt the whole workspace — every unchanged package then fails with
  "You cannot publish over the previously published versions" and reddens a
  release that otherwise succeeded.
- Allow the workflow to be run manually (`workflow_dispatch`), so a dropped
  push event cannot strand a merged changeset with no way to fire the release.
