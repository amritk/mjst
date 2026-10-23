---
name: Faster mjst lint — startup and lazy match paths
overview: Cut the ~115 ms of module loading every `mjst lint` run pays before linting starts, and stop building a normalized path for every JSONPath match when most never become findings. Two independent PRs, plus an optional vacuum bench once both land.
stages:
  - id: startup
    title: "lint: load less at startup"
    goal: A tiny-spec `mjst lint` loads only the modules the run needs, with the public API unchanged
    verification: bun run check && bun run versions:check && bun run build && bun run types:check && (cd packages/lint && bun run test) && (cd packages/cli && bun run test) && bun run test:dist
    todos:
      - id: startup-profile
        content: Profile `mjst lint` on a tiny spec with `node --cpu-prof` and an import trace, for `-r oas` and a core-functions ruleset, and record the baseline — see Startup › Measure first
      - id: startup-defer
        content: Defer each module the profile shows the run does not need behind a dynamic `import()` at its first use — see Startup › What to defer
      - id: startup-api
        content: Prove the `@amritk/lint` public surface is unchanged (runtime export keys of every subpath, emitted `.d.ts`, no newly async function) — see Startup › API guard
      - id: startup-bench
        content: Measure after, with the same hyperfine commands on Node and Bun, and put the before/after table in the PR — see Startup › Bar
      - id: startup-changeset
        content: Add a patch changeset for the packages touched — see Changesets
  - id: lazy-paths
    title: "lint: build a match's path only when it becomes a finding"
    goal: JSONPath matches carry the internal node through the runner and build `path` only for findings or when a rule function reads it, with byte-identical findings
    verification: bun run check && bun run versions:check && bun run build && bun run types:check && (cd packages/lint && bun run test) && (cd packages/cli && bun run test)
    todos:
      - id: paths-baseline
        content: Record `bench:large` (all phases, with fingerprints), `mjst lint openai.yaml -r oas` on Node and Bun, and GC share from `--cpu-prof` on main — see Lazy paths › Measure first
      - id: paths-internal-query
        content: Add an internal query variant in `packages/lint/src/core/jsonpath.ts` that returns matches holding the `Node` and builds `path` on demand, leaving `query`/`queryCompiled`/`queryMany` results unchanged — see Lazy paths › Shape
      - id: paths-runner
        content: Switch `packages/lint/src/core/runner.ts` (and any other internal caller) to the lazy variant so a path is built only for a finding or a function that reads `path` — see Lazy paths › Shape
      - id: paths-tests
        content: Add tests that a rule function reading `path` still gets the normalized path, and that the public query functions return the same values as before — see Tests
      - id: paths-bench
        content: Re-run the same measurements, require every fingerprint to match the baseline, and put the table in the PR — see Lazy paths › Bar
      - id: paths-changeset
        content: Add a patch changeset for `@amritk/lint` — see Changesets
  - id: vacuum-bench
    title: "lint bench: add vacuum beside Spectral"
    goal: The lint bench can time vacuum v0.35.0 on the same specs as Spectral, doing the same work
    verification: bun run check && bun run versions:check && (cd packages/lint && bun run types:check) && (cd packages/lint && bun run bench)
    todos:
      - id: vacuum-runner
        content: Add vacuum v0.35.0 as a bench competitor in `packages/lint/bench` beside Spectral, run with `-g 300` — see Vacuum bench
      - id: vacuum-changeset
        content: Add an empty changeset (`bunx changeset --empty`) — see Changesets
---

# Faster mjst lint

## Context

Measured at `8ae7958` (Linux x64, 4 vCPU, Node 22.22, Bun 1.4.2):

- `node -e 0` is 25 ms; `mjst lint` on an almost empty OpenAPI file is 179 ms on Node and 138 ms on Bun; vacuum is 51 ms. On petstore mjst is 228 ms against vacuum's 88 ms, so startup is vacuum's whole lead on small specs.
- Warm imports on Node: `packages/cli/dist/lint/run.js` 141 ms, `packages/lint/dist/rules/openapi/index.js` 110 ms, `packages/lint/dist/index.js` 93 ms, `resolve-refs` / `runtime-validators` / `yaml` 34–42 ms each (25 ms of that is Node). About 115 ms of every run is module loading.
- CPU profile of `mjst lint openai.yaml -r oas` (2.8 MB) and the 38 MB `bench:large` spec: JSONPath matching + runner 37% / 41%, GC 8.5% / 16%, top function `toMatches` in [jsonpath.ts](packages/lint/src/core/jsonpath.ts) 10% / 14%. `toMatches` builds `normalizePath(pathOf(node))` for every match. The 38 MB oas preset takes 6.5 s and peaks at 2.1 GB on Bun (8.4 s, 1.3 GB on Node).

## Approach

Each PR is the change its profile justifies and nothing else. The two touch disjoint files (`startup` owns the barrel, presets, functions, parsers and CLI lint code; `lazy-paths` owns `core/` except `core/lint.ts`), so they are developed in parallel; `startup` merges first only because it is the smaller diff. `vacuum-bench` is optional and starts only after both merge.

## Startup

**Owns:** `packages/lint/src/index.ts`, `packages/lint/src/core/lint.ts`, `packages/lint/src/functions/**`, `packages/lint/src/parsers/**`, `packages/lint/src/rules/**`, `packages/lint/src/fix/**`, `packages/lint/src/ruleset-files.ts`, `packages/lint/src/index.test.ts`, `packages/cli/src/lint/**`, `packages/cli/src/cli.ts`, `packages/cli/src/parse-yaml-strict.ts`, `packages/cli/src/has-external-refs.ts`, `packages/cli/src/describe-resolve-error.ts`, `packages/cli/src/resolve-policy.ts`, `packages/cli/src/allowed-roots-hint.ts`, `scripts/*.test.ts`, `.changeset/lint-lazy-startup.md`

### Measure first

Build (`bun run build`), then on a tiny OpenAPI file (write one to a scratch dir; do not add a fixture unless a test needs it) profile `node packages/cli/dist/cli.js lint <file> -r oas` and the same with a small ruleset of core functions only (`truthy`, `pattern`, `length`, …) using `node --cpu-prof`, and log the import graph (for example `NODE_DEBUG=module` or a `--import` loader hook that prints each resolved URL). List what loads that the run does not use. Suspects, to confirm or rule out from the trace, not to assume:

| module | needed only when |
|---|---|
| `rules/openapi`, `rules/asyncapi` and their functions/schemas | `-r` names that preset (or a ruleset `extends` it) |
| `@amritk/runtime-validators` (via `functions/schema.ts`) | some rule uses `schema` |
| `@amritk/yaml` and the YAML parser path in `parsers/` | the input or ruleset is YAML |
| `@amritk/resolve-refs` (via `cli/src/lint/resolver.ts`) | `$ref` resolution is on (not `--no-resolve`) |
| `fix/`, `yargs`, `fast-glob`, anything else the barrel imports eagerly | the trace shows they are unused on this path |

### What to defer

Move each confirmed module behind a dynamic `import()` at its first use, cached so it loads once. Where the consumer is synchronous (a rule function such as `schema`), load the module in an async step the run already has before rules execute (for example while the ruleset is being built or the document resolved), keyed on whether the ruleset uses it — never by making a sync public function async. Prefer moving the lazy point into the CLI over changing the library barrel when either works.

### API guard

The public API must not change: same exports, same types, no new async where there wasn't any. Show it: compare `Object.keys(await import(...))` for every `@amritk/lint` export subpath, and diff the emitted `.d.ts` files, between `main` and the branch. Paste the result (empty diffs) in the PR.

### Bar

`hyperfine -N --warmup 2 --runs 10`, before (main) and after, on Node and Bun, for the tiny spec with `-r oas` and with the core-functions ruleset. One table in the PR: command × runtime × before mean ± σ × after mean ± σ × delta. Include `node -e 0` / `bun -e 0` as the floor. Report what was measured, including a case that did not improve.

## Lazy paths

**Owns:** `packages/lint/src/core/**` except `packages/lint/src/core/lint.ts`, `.changeset/lint-lazy-match-paths.md`

### Measure first

On `main`, record: `bun run bench:large` from `packages/lint` (all phases — `rules`, `lint (text)`, `lint (data)`, `preset` — with each phase's fingerprint); `mjst lint fixtures/openapi/real-world/openai.yaml -r oas` with `hyperfine -N --warmup 2 --runs 10` on Node and Bun; and the GC share (`(garbage collector)` self time ÷ total) from a `node --cpu-prof` run of that command.

### Shape

Today `toMatches` turns every matched `Node` into `{ value, path: normalizePath(pathOf(node)) }`. Add an internal variant (not exported from the package barrel) whose matches keep the `Node` and compute `path` on first access, memoized — a getter or an explicit `pathOf` call, whichever the runner reads more cheaply. The runner uses that variant and builds the path only when a match yields a finding or when the rule's function reads `path` from its context. `query`, `queryCompiled` and `queryMany` keep returning exactly `IQueryMatch[]` with eager `path`, implemented on top of the internal variant. Findings must be byte-identical: same order, same paths, same messages.

### Bar

Re-run the baseline measurements on the branch. Every `bench:large` fingerprint must equal the baseline's; a mismatch blocks the PR. One table in the PR: each bench phase, openai.yaml `-r oas` on Node and Bun, and GC share — before, after, delta, plus the fingerprints.

## Vacuum bench

**Owns:** `packages/lint/bench/**`, `packages/lint/README.md`, `.changeset/lint-bench-vacuum.md`

Optional; starts only after `startup` and `lazy-paths` both merge. Add vacuum v0.35.0 (installed with `go install github.com/daveshanley/vacuum@v0.35.0`) as a competitor beside Spectral in `packages/lint/bench`. Its default 5 s per-rule timeout skips `$..properties[*]` on the OpenAI spec, so run it with `-g 300` and state that caveat where the bench documents its competitors. Skip it gracefully, as the bench does for any missing competitor, when `vacuum` is not on `PATH`.

## Changesets

Each stage adds its own changeset file with the name in its Owns line. `startup` and `lazy-paths` are `patch` for every published package they touch; `vacuum-bench` is `--empty`. Never `major`.

## Out of scope

- Any change to findings, rule behaviour, CLI flags or output.
- Refactors the profiles do not point at; new caching layers beyond the lazy loads and lazy paths above.
- Coverage configuration (this run waives the coverage gate; see the tracking issue).

## Tests

- `startup`: existing `packages/lint/src/index.test.ts`, `packages/cli/src/lint/run.test.ts` and `scripts/*.test.ts` (dist) must pass unchanged; add a test where a deferred module's lazy load is the behaviour under test (for example a `schema` rule still validates when it is the first rule to use it).
- `lazy-paths`: mirror [jsonpath.test.ts](packages/lint/src/core/jsonpath.test.ts) — public query results unchanged; a custom function reading `context.path` gets the same path as before; a match that yields no finding never builds its path (spy on the path builder).

## Verification

Each stage's `verification` command in the frontmatter, plus its Bar section. Targeted tests during review rounds: `NODE_ENV=production bunx vitest run <test file>` from the repo root.
