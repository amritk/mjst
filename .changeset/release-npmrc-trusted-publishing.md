---
---

ci: stop using setup-node's `registry-url` in the release workflow, which wrote an `.npmrc` with a deprecated `always-auth` line and an empty `_authToken`. Under trusted publishing (OIDC) that empty token made changesets' pre-publish "already on npm?" check fail, so `changeset publish` tried to republish every already-published package and the run went red. A clean registry-only `.npmrc` keeps those reads anonymous so already-published packages are skipped.
