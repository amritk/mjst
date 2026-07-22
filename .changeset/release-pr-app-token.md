---
---

CI: author the changesets Release PR with a GitHub App token instead of the
default `GITHUB_TOKEN`. Bot-authored (`github-actions[bot]`) PRs are gated
behind the "requires approval from a maintainer" screen and often don't run CI
at all; an App is a trusted actor, so the Release PR runs CI automatically with
no approval. Also renames the PR from "Version Packages" to "Release" via the
action's `title`/`commit` inputs. Empty changeset: no version bump intended.
