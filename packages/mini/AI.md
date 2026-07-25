# @amritk/mini — notes for AI coding agents

A deliberately tiny signals-based UI layer: reactive DOM bindings plus a
compilerless JSX runtime. This file is the fast path for an LLM; the full
reference is [README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions. It builds **real DOM once** —
> there is no virtual DOM, no diffing, no re-render, no `useState`, no hooks.
> If you reach for those, you want Preact or Solid, not mini.

## The one rule that trips up every agent

Reactivity is decided by **value shape at runtime**, because there is no
compiler analysing your code:

- A **function-valued** attribute / child / `show` is **reactive** — re-applied
  whenever the signals it reads change.
- Any **other value** is **static** — applied once at creation, never again.

A signal is a zero-arg function, so pass it **without calling it** to bind live:

```tsx
<button disabled={streaming}>        {/* ✅ reactive — tracks forever        */}
<button disabled={streaming()}>      {/* ❌ STATIC — frozen at creation!      */}
<span>{() => count() * 2}</span>     {/* ✅ reactive derived text             */}
<span>{count()}</span>               {/* ❌ static text, frozen               */}
<button onClick={() => count(count() + 1)}>+</button>  {/* ✅ calls are fine inside handlers */}
```

Calling the signal reads it once and hands the runtime a plain value. When an
attribute should track state, pass the signal itself or a thunk. The repo ships
a guard for exactly this mistake: the `@amritk/mini/vite` plugin
(`catchCalledSignals`) flags it live in the dev server and fails `vite build`,
and `bun run check:reactivity` runs the same check in CI.

## Signals

```ts
import { signal, computed, effect, batch } from '@amritk/mini'

const count = signal(0)
count()            // read  → 0
count(count() + 1) // write → 1  (setter takes the value; there is no `.set`)
const doubled = computed(() => count() * 2)
effect(() => console.log(doubled())) // re-runs on every change; runs sync
batch(() => { count(1); count(2) })  // one propagation pass, not two
```

## Building UI

```tsx
import { signal, mount, list } from '@amritk/mini'

const Counter = () => {
  const n = signal(0)
  return (
    <button onClick={() => n(n() + 1)}>
      {() => `clicked ${n()} times`}
    </button>
  )
}

const dispose = mount(document.body, Counter) // owns the tree; dispose() tears it down
```

- **`mount(container, Component)`** — the only correct entry point. It opens the
  `effectScope` that owns every effect/`onCleanup` a component creates. Appending
  `container.appendChild(App())` yourself leaks effects.
- **`list(container, items, key, create)`** — keyed collections. `items` is a
  getter (pass the signal). `container` must be owned solely by the list.
- **`onCleanup(fn)`** — teardown; must be called synchronously inside a
  component (i.e. inside a `mount`/`list` scope).
- **`bindText`/`bindValue`/`bindAttr`/`bindClass`/`bindShow`/`bindChecked`/`bindSelect`** —
  imperative bindings for `template()` or `ref` code. `bindHtml` is the *only*
  `innerHTML` sink and takes a required `sanitize` argument.

## JSX setup

Set in the consuming package's `tsconfig.json` — mini does **not** use the React
runtime:

```jsonc
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@amritk/mini" } }
```

No fragments (`<>…</>`), no `dangerouslySetInnerHTML`, no event options. A JSX
expression **is** the `HTMLElement` — components return the element directly.

## Subpath entry points (tree-shakeable; core stays tiny)

| Import | Purpose | Extra peer dep |
|---|---|---|
| `@amritk/mini` | signals, `mount`, `list`, binds, JSX | — |
| `@amritk/mini/router` | client-side router (`createRouter`, `Link`, `RouterView`) | — |
| `@amritk/mini/flow` | `Show` / `Switch` / `Match` / `For` / `Dynamic` control-flow | — |
| `@amritk/mini/forms` | `createForm` field state + validation | `@amritk/runtime-validators` (schema arm only) |
| `@amritk/mini/query` | `createQuery` cache/dedupe/retry adapter | `@tanstack/query-core` |
| `@amritk/mini/hot` | `hotMount` — hot reloading at the app entry point | — |

Install: `bun add @amritk/mini` (or npm/pnpm/yarn).

## Hot reload

Both halves are required — the plugin marks the boundary, the helper owns the
teardown:

```ts
// vite.config.ts
import { acceptHotUpdates } from '@amritk/mini/vite'
plugins: [acceptHotUpdates()]
```

```tsx
// main.tsx — the entry module, and the only place this belongs.
import { hotMount } from '@amritk/mini/hot'

hotMount(document.body, App, import.meta.hot)
```

- Swap `mount` for `hotMount` **at the entry only**. Without a hot boundary, Vite
  cannot find a module that accepts the update and reloads the whole page on
  every edit.
- **The plugin is not optional.** Vite scans module *source* for
  `import.meta.hot.accept(`; a runtime `accept` reached through a helper does not
  register, so `hotMount` alone still full-reloads. The plugin appends that call
  to whichever module calls `hotMount`.
- Pass `import.meta.hot` straight through — do **not** write
  `if (import.meta.hot)` yourself. It is `undefined` in a production build, where
  `hotMount` is exactly `mount`.
- Signal state **resets** on each reload: no compiler and no component identity
  means there is nothing to map old signals onto. State that must survive edits
  belongs in a separate store module (unchanged modules keep their instance).
- Never register your own `hot.dispose()` — the runtime keeps one disposer per
  module, so it would replace mini's and leak the old tree. Extra teardown goes
  in an `onCleanup` inside the root component.
- Keep the entry thin: it re-runs on every edit below it.
