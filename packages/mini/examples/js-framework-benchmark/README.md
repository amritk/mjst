# mini — js-framework-benchmark (keyed)

A keyed [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
implementation in [`@amritk/mini`](../../README.md). It exists to show how mini's
fast paths line up with the operations that benchmark measures — the
create/update/reorder-heavy data grid the core README explicitly points at a
real framework for. It is an **example**, not part of the published package.

## The four techniques

Each maps to a column the benchmark scores:

| Technique | Where | Moves the column |
|:--|:--|:--|
| **`template()`-cloned rows** | `createRow` in `main.ts` | *create*, *replace all*, *create many* — one `cloneNode` per row instead of a dozen `createElement`s |
| **Keyed `list`** | `list(tbody, rows, …)` | *swap* (2 moves), *remove* (0 moves), *append* (fragment-batched) — mini's move-minimal two-ended diff |
| **O(1) select** | `setSelected` | *select row* — toggles `danger` on the two rows that change, never a per-row reactive class that all 1,000 rows re-read |
| **Event delegation** | one `tbody` `click` listener | *create* / memory — 1,000 rows add one listener, not 2,000, via `event.target.closest` |

Only the label is reactive: a per-row `signal` bound with `bindText`, so *partial
update* rewrites just the touched cells and never reconciles the list (the `rows`
array reference is unchanged, so the `list` effect does not re-run).

### On delegation and the charter

mini's core keeps `on*` props as plain `addEventListener` — delegation is
deliberately **out of the core charter**. That is not a limitation to route
around in the library; it is an app-level concern, so this example wires the one
delegated listener itself through the `<tbody>` node, which is exactly the
"anything fancier takes a `ref`" escape hatch the JSX runtime documents.

## Running it

The implementation and its behavior are covered by `main.test.ts` (happy-dom):

```bash
bun run --filter='@amritk/mini' test   # includes this example's test
```

To run the page in a browser, serve it with a bundler that resolves
`@amritk/mini` from the workspace — from this directory:

```bash
npx vite
```

Then open the printed URL. `index.html` loads Bootstrap 3 (the benchmark's
stylesheet) and mounts `bootstrap.ts`. To drop it into the real benchmark
harness, copy `main.ts` + `bootstrap.ts` into a
`frameworks/keyed/mini` entry and point its `index.html` at the bundle.

## Files

- `main.ts` — the store, the row template, and the wired-up UI (`createBenchmarkApp`).
- `bootstrap.ts` — mounts the app into `#main`.
- `index.html` — the benchmark page shell.
- `main.test.ts` — behavioral coverage for every measured operation.
