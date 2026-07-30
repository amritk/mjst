---
---

Scope the PR benchmark report to the packages a change can actually move.
`scripts/bench-scope.ts` resolves the workspace graph and narrows the suites to
the edited packages plus their transitive dependants, and `packages/yaml` gains
an isolated bench worker so YAML parser changes show up in the table.
