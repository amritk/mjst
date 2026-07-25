# AGENTS.md — @amritk/mini

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md) and [`../../CLAUDE.md`](../../CLAUDE.md).
Consuming the package instead? See [`AI.md`](./AI.md).

A deliberately tiny signals UI layer: reactive DOM bindings + a compilerless JSX
runtime built on alien-signals.

## Commands

```bash
bun run --filter='@amritk/mini' test
bun run check:reactivity   # the footgun guard (also ships as the @amritk/mini/vite plugin)
bun run --filter='@amritk/mini' types:check
```

## Invariants — do not break these

- **The cap is the design.** No virtual DOM, no diffing, no re-render. JSX builds
  real DOM once; dynamic values flow through bind helpers or function-valued
  props; repetition goes through `list`. If a feature seems missing, the answer
  is usually "use Preact/Solid", **not** a new helper. Adding surface area needs
  a strong justification.
- **Reactivity is decided by value shape at runtime:** a function-valued
  attribute/child/`show` is reactive; anything else is static. The classic bug is
  calling a signal in JSX (`disabled={streaming()}`) — the `@amritk/mini/vite`
  plugin guards it live in the dev server, and `check:reactivity` runs the same
  check in CI. If you add a `.tsx` test that intentionally freezes a signal, mark
  the line `// mini-static-ok`.
- **`bindHtml` is the only `innerHTML` sink**, and its `sanitize` argument is
  required at every call site — never add a default. Everything else writes
  through `textContent` / attributes / `classList`.
- **Subpaths (`router`/`flow`/`forms`/`query`/`hot`) must add zero bytes to the
  `.` entry.** `forms`' schema arm and `query` depend on **optional** peers
  (`@amritk/runtime-validators`, `@tanstack/query-core`) — keep them optional.
  `hot` is why `mount` itself has no hot-reload branch: the widget ships one
  static bundle and must not pay for a dev-server feature.
- **`show` and `style` share one inline `display` slot.** Applying a style bag
  replaces the inline style wholesale, so a style write would otherwise un-hide
  what `bindShow` hid — and which won came down to the order the attributes were
  typed in. `applyDisplay` in `bind.ts` arbitrates; anything new that writes
  `display` has to go through it.
- This package **ships its `src/`** too (see `files`), so source comments are
  shipped — keep them accurate.

## The alien-signals scope-ownership gotcha

A scope created inside a running `effect` is **disposed when that effect
re-runs**, before the next run's body starts. That is usually what you want, and
it is fatal anywhere a long-lived subtree is built from inside a tracking effect.

`list` is exactly that case. Rows are built inside the reconciliation effect,
which re-runs on every change to the collection, so appending one row used to
dispose the scope of every row already on screen — the nodes stayed in the
document looking perfectly correct while all of their bindings quietly stopped
updating, and each surviving row's `onCleanup` fired as though the row had been
removed. `run-detached.ts` is the fix, and because detaching also removes the
chain that used to dispose rows when the component unmounted, `list` registers
its teardown with `onCleanup` to restore it. `list.test.ts` carries a regression
test for each half.

`internal/render-child.ts` is the opposite case and deliberately relies on the
engine behaviour: its branch scope is meant to be tied to the swap effect, and
the swap effect to the component's scope, which is why `Show` can ignore the
returned teardown without leaking a branch. Do not "fix" it to match `list`.

## The reserved-`key` gotcha

`key` is reserved by JSX. The transform hoists any `key` attribute out of the
props object into the runtime's third parameter *before the component is
called*, so a component with a legitimate prop of that name — `For`, whose `key`
is the row identity function — would never receive it. `jsx` forwards it back
into props for component tags; `flow/for.test.tsx` pins that. It stays ignored
for element tags, where there is no keying at the JSX level at all.

Add a changeset for every change (`bunx changeset`).
