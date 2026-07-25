# AGENTS.md — @amritk/mini-native

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md) and [`../../CLAUDE.md`](../../CLAUDE.md).
Consuming the package instead? See [`AI.md`](./AI.md).

A React-Native-shaped UI runtime on `@amritk/mini`'s model: real host nodes
created once, mutated forever by signals, with no virtual tree in between. It
renders to a native view tree, to the DOM, or to plain objects, depending only on
which **host** is installed.

## Commands

```bash
bun run --filter='@amritk/mini-native' test
bun run --filter='@amritk/mini-native' types:check   # runs both passes: DOM-free core, then the DOM host
bun run --filter='@amritk/mini-native' build
```

## Layout

```
src/
  host.ts                 The Host contract — the entire platform surface
  current-host.ts         setHost / requireHost / scheduleFlush (one host per context)
  types.ts                MaybeReactive, ClassValue, StyleValue, opaque node handles
  elements.ts             The element vocabulary (view/text/image/scroll-view/input)
  jsx-runtime.ts          The compilerless JSX runtime + the JSX type surface
  jsx-dev-runtime.ts      Dev entry point (same implementation)
  apply-prop.ts           One prop → host calls, deciding static-vs-reactive
  append-children.ts      Children, including reactive text nodes
  list.ts                 The only reconciler: keyed list over four host ops
  render-child.ts         Reactive single-slot swap, the base of control flow
  mount.ts                Application root — opens the owning scope
  run-detached.ts         Escape hatch for scope ownership (see the gotcha below)
  untrack.ts              The same suspension, named for the reader's side of it
  watch.ts                Change-only effect with an untracked callback
  signals.ts              alien-signals re-exported (plus batch), so nothing else imports it
  warn.ts                 Recoverable-mistake reporting, without assuming a console
  bind/                   bind-text, bind-prop, bind-show, bind-value
  flow/                   Show, Switch/Match, Dynamic, For, Index, defaultKey
  hosts/
    create-memory-host.ts The reference host — plain objects, no platform
    create-dom-host.ts    Web preview target (the ONLY file that knows about HTML)
    create-lynx-host.ts   Native target, driving Lynx's Element PAPI
    lynx-element-api.ts   The PAPI subset, as an injectable type
    to-style-text.ts      Numbers → the target's unit, shared by the real hosts
```

## Invariants — do not break these

- **The core is platform-free, and the compiler enforces it.** `tsconfig.json`
  omits `lib.dom` (and Node's ambient types), so a stray `document`,
  `HTMLElement`, or host global anywhere outside the DOM host fails
  `types:check` rather than quietly working in a browser and breaking on a
  device. `create-dom-host.ts` is excluded there and checked by
  `tsconfig.dom.json` instead; the `types:check` script runs both passes.
- **The element vocabulary is native, not HTML.** `JSX.IntrinsicElements` is
  `view | text | image | scroll-view | input`. Adding an HTML tag inverts the
  whole design — the browser is the *guest* here, a preview target for a native
  app. New vocabulary needs a genuine cross-platform justification.
- **No reconciler beyond `list`.** JSX builds a host node once and signals
  mutate it in place. If a feature seems to need diffing, it belongs in a
  different framework, not here.
- **`Host` stays small** (about 15 functions) — it is the entire porting cost of
  a new platform. `createFlowHost` is separate from `createElement` because the
  right wrapper differs per target; `flush` is optional, for targets that batch.
- **Visibility survives a style write.** `setVisible` and `setStyle` are easiest
  to implement through one channel, and then a wholesale style replacement
  quietly un-hides a hidden element — which is order-dependent on how the props
  happened to be written, so it fails intermittently. Any host sharing a channel
  between the two must remember the visibility and re-assert it. Both real hosts
  do; the memory host keeps them as separate fields, which is why its tests
  could not catch the bug.
- **No raw-markup sink, ever.** There is deliberately no `bindHtml` equivalent
  anywhere in the host contract, so bound data cannot inject elements on any
  target.
- This package **ships its `src/`** too (see `files`), so source comments are
  shipped — keep them accurate.

## The alien-signals scope-ownership gotcha

A scope created inside a running `effect` is **disposed when that effect
re-runs**. This bites exactly two places — `list` and `renderChild` — both of
which build long-lived subtrees from inside a tracking effect.

In a keyed list the symptom is nasty because it looks fine: appending one row
would dispose every row already on screen, leaving the nodes in place with the
right text while all of their bindings quietly stopped updating.
`run-detached.ts` is the fix — it builds those subtrees with no reactive owner
installed, handing lifetime back to the code that actually knows when a subtree
should die.

`list.test.tsx` has a regression test named *"keeps existing rows reactive after
another row is appended"* that fails without it.

> `@amritk/mini` had the same latent bug, and a comment in its `render-child.ts`
> asserted the opposite behaviour. Both are fixed there now — it has its own
> `run-detached.ts` — so the two packages agree about how the engine behaves.

## The reserved-`key` gotcha

`key` is reserved by JSX. The transform hoists any `key` attribute out of the
props object into the runtime's third parameter *before the component is ever
called*, so a component with a legitimate prop of that name — `For`, whose `key`
is the row identity function — would never receive it. `jsx` forwards it back
into props for component tags, and `flow/for.test.tsx` pins that. It stays
ignored for element tags, where there is no keying at the JSX level at all.

> `@amritk/mini` had this hole too — its `for.test.tsx` only ever called
> `For({…})` directly, which is likely why nobody noticed. Fixed there as well.

## Testing

Vitest, per [`../../.claude/testing.md`](../../.claude/testing.md). Every suite
except the DOM host runs against `createMemoryHost` in the default node
environment, where `document` genuinely does not exist — so a stray platform
dependency could not pass unnoticed. `jsx-runtime.test.tsx` asserts that
directly. Only `create-dom-host.test.tsx` carries the
`// @vitest-environment happy-dom` pragma.

The Lynx host takes its PAPI as an argument specifically so
`create-lynx-host.test.tsx` can verify the whole mapping against a fake engine —
no device, no emulator.

## Known gaps

See the README's *Known gaps* for the full list. The short version: `bindClass`
and fragments are deliberate omissions; accessibility props, a virtualised list,
gestures beyond tap, an animation seam, context/portal/error boundaries, and the
router / forms / query subpaths are simply not built yet. `docs/mini-native-audit.md`
at the repo root carries the reasoning and the priority order.

Add a changeset for every change (`bunx changeset`).
