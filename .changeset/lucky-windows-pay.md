---
---

CI: allow the release workflow to be run manually (`workflow_dispatch`), so a
dropped push event cannot strand a merged changeset with no way to fire the
release.
