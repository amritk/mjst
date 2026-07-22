<div align="center">

# @amritk/mini

**A deliberately tiny signals-based UI layer: reactive DOM bindings plus a compilerless JSX runtime.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![size](https://img.shields.io/badge/deps-1%20(alien--signals)-f97316?style=flat-square)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/mini` is a minimal UI layer built on [alien-signals](https://github.com/stackblitz/alien-signals): fine-grained reactivity plus a small, capped set of DOM helpers and a compilerless JSX runtime. It ships from the [mjst](../../README.md) monorepo.

**The cap is the design.** There is no virtual DOM, no diffing, and no re-render. JSX (or `template`) builds real DOM **once**; dynamic values flow through the bind helpers or function-valued props; and repetition goes through `list`. A component function runs a single time and returns the `HTMLElement` it built. If a feature seems to be missing here, the correct next step is usually a real framework (Preact or Solid), not a new helper.

---

## Installation

```bash
npm install @amritk/mini
# or
pnpm add @amritk/mini
# or
yarn add @amritk/mini
# or
bun add @amritk/mini
```

---

## The reactivity rule

There is no compiler analysing your expressions, so reactivity is decided by **value shape at runtime**:

- A **function-valued** attribute, child, or `show` is reactive — the runtime wraps it in an effect and re-applies it whenever the signals it reads change.
- Any **other value** is static — applied once at creation, never again.

Signals are zero-argument functions, so passing one **without calling it** is already a live binding:

```tsx
<button disabled={streaming}>      {/* reactive — tracks forever          */}
<button disabled={streaming()}>    {/* STATIC — frozen at creation!       */}
<span>{() => count() * 2}</span>   {/* reactive derived text              */}
```

---

## API

### Reactivity (`@amritk/mini`)

| Export | Purpose |
|:---|:---|
| `signal(initial?)` | A writable signal. Call with no argument to read, with one to write. |
| `computed(fn)` | A derived, read-only signal. |
| `effect(fn)` | Run `fn` and re-run it whenever the signals it reads change. Returns a stop function. |
| `effectScope(fn)` | Group effects so a single dispose tears them all down. |
| `batch(fn)` | Coalesce several writes into one propagation pass. |
| `watch(get, cb, opts?)` | Fire `cb(value, previous)` on change, **skipping** the initial run — mini's `watch`. Pass `{ immediate: true }` to also run once on setup (with `previous` as `undefined`). |
| `onCleanup(fn)` | Register teardown to run when the enclosing `effectScope` is disposed. |
| `mount(container, component)` | Run `component` in an owning `effectScope`, append its node, and return a `dispose` that removes the node and tears the scope down. The application root — use it so top-level bindings and `onCleanup` have an owner. |
| `Signal<T>`, `ReadonlySignal<T>` | Types for the two halves of a signal. |

### DOM bindings (`@amritk/mini`)

Each binding ties one node property to a signal-reading getter and returns the effect's stop function. They write through `textContent`, attributes, and `classList` — never `innerHTML` — so bound data cannot inject markup.

| Export | Purpose |
|:---|:---|
| `bindText(node, get)` | Keep `node.textContent` in sync. |
| `bindAttr(node, name, get)` | Keep an attribute in sync (`false`/`null` removes it, `true` sets it bare). |
| `bindClass(node, name, get)` | Toggle a single class. |
| `bindShow(node, get)` | Show/hide via inline `display`. |
| `bindValue(node, model)` | Two-way bind a text input/textarea to a string signal — mini's `v-model`. Holds writes during IME composition and commits on `compositionend`. |
| `bindChecked(node, model)` | Two-way bind a checkbox/radio to a boolean signal — the `.checked` analogue of `bindValue`. |
| `bindSelect(node, model)` | Two-way bind a `<select>` to a string signal — sets `.value` (the property, so the option selects) and writes back on `change`. |
| `bindHtml(node, sanitize, get)` | The **one** sanctioned `innerHTML` sink; the sanitizer is a required argument at every call site. |

### Structure (`@amritk/mini`)

| Export | Purpose |
|:---|:---|
| `template(html)` | Parse a static HTML string once; returns a clone factory that also collects `data-ref` nodes. |
| `list(container, items, key, create)` | Keyed reactive list: one node per key, disposed when its key leaves. |

### JSX runtime (`@amritk/mini/jsx-runtime`, `@amritk/mini/jsx-dev-runtime`)

The automatic runtime TypeScript targets when a package sets `"jsx": "react-jsx"` and `"jsxImportSource": "@amritk/mini"`. Exposes `jsx`, `jsxs`, `jsxDEV`, and the `JSX` namespace, plus the `Component`, `MaybeReactive`, `MiniChild`, `MiniChildren`, `ClassValue`, `StyleValue`, and `TargetedEvent` types.

SVG tags are created in the SVG namespace, so `<svg>`/`<path>`/… render as real SVG. `class` accepts a string, an array (falsy entries dropped), or a `{ name: boolean }` toggle map; `style` accepts a cssText string or a property object (camelCase keys are kebab-cased) — each still static-or-reactive by the value-shape rule.

---

## Layered modules (subpath exports)

The `.` entry above is the whole story for the bundle-size-sensitive embed widget: its only runtime dependency is `alien-signals`, and it imports **no** subpath module. The dashboards — which are not bundle-constrained — opt into more through tree-shakeable subpath exports. Each is its own module graph with its own README section below; importing one pulls in **none** of the others, and the widget that imports only `.` pays zero bytes for any of them. Two tests enforce this: a core import-boundary walk (`src/import-boundary.test.ts`) and a gzipped size budget on the bundled `.` entry (`src/core-size-budget.test.ts`).

Composition is by **explicit import** in the consuming app — there is no runtime plugin registry and no `mini.use()`, because a registry would defeat tree-shaking. Dependencies are prop-drilled, not injected through a context.

### Client router (`@amritk/mini/router`)

A small client-side router for the dashboards, in history or hash mode.

| Export | Purpose |
|:---|:---|
| `createRouter({ routes, mode?, base? })` | Matches the URL against a route table into a reactive `route` signal; returns `{ route, navigate, stop }`. Attaches its location listener immediately. The `route` state includes a parsed `query` record alongside the raw `search`. |
| `matchRoute(pattern, path)` | Matches a `/users/:id` pattern (with an optional trailing `*` catch-all) against a pathname, returning captured params or `null`. |
| `Link` | An `<a href>` that intercepts a plain left-click and calls `navigate` — modified clicks, non-primary buttons, and `preventDefault`ed events are left to the browser. Takes `navigate` as a prop (`navigate={router.navigate}`). |
| `RouterView` | Renders the matched route's view (the `view` key by default) and swaps it on navigation — the outlet that replaces a hand-written `route().route?.['view']` cast. Takes `router={router}`. |
| `Route`, `RouterMode`, `RouterOptions`, `RouteState`, `Router`, `NavigateOptions`, `RouteParams`, `LinkProps`, `RouterViewProps` | Exported types. |

```tsx
import { createRouter, RouterView } from '@amritk/mini/router'

const router = createRouter({
  routes: [
    { path: '/', view: Home },
    { path: '/users/:id', view: User },
    { path: '*', view: NotFound },
  ],
})

// RouterView reads the matched route's `view` and swaps it on navigation.
const app = <RouterView router={router} fallback={NotFound} />
```

### Control flow (`@amritk/mini/flow`)

The ergonomic control-flow components the core deliberately omits — each reuses a core primitive and adds nothing to `.`. Because mini has no compiler, JSX children are built eagerly; pass a **function** child to defer construction to when a branch is shown (and rebuild on re-entry), or a **node** to reuse and preserve its state.

| Export | Purpose |
|:---|:---|
| `Show` | `<Show when={cond} fallback={…}>` — mounts one branch, tears down the other (bindings included). Truthiness drives it, so `when={user}` works. |
| `For` | `<For each={items} key={…}>{(item, i) => …}</For>` — keyed list backed by the core `list`. `key` defaults to an object `id` / primitive value / index; supply it for reordering lists. Pass `as` (with `class`/`style`/`ref`) to render into a real element instead of the default `display: contents` host — needed when the container itself is styled, e.g. a `divide-y` list whose separators only match direct children: `<For each={rows} as="ul" class="divide-y">`. |
| `Switch` / `Match` | `<Switch fallback>…<Match when={…}>…</Match></Switch>` — renders the first truthy branch; only the winner is built. |
| `Dynamic` | `<Dynamic component={tag} {...props}/>` — renders a tag or component chosen at runtime (`component` is a tag string or a getter/signal returning the tag/component). |
| `ShowProps`, `ForProps`, `SwitchProps`, `MatchProps`, `DynamicProps`, `DynamicComponent`, `ChildFactory` | Exported types. |

```tsx
import { For, Show } from '@amritk/mini/flow'

const Todos = (todos: () => readonly Todo[]): HTMLElement => (
  <ul>
    <Show when={() => todos().length} fallback={() => <li>nothing yet</li>}>
      {() => <For each={todos} key={(t) => t.id}>{(t) => <li>{t.title}</li>}</For>}
    </Show>
  </ul>
)
```

### Forms (`@amritk/mini/forms`)

Field state (value / dirty / touched / errors as signals), submit handling, and validation. Inputs wire up through the core `bindValue`.

| Export | Purpose |
|:---|:---|
| `createForm({ initialValues, validate?, onSubmit? })` | Returns `{ values, errors, isValid, isDirty, isSubmitting, submitted, field, bind, setValue, reset, handleSubmit }`. Errors recompute reactively; each field withholds its message until blurred or the form is submitted. A field's type follows its initial value (`string`, `number`, or `boolean`), and `bind` wires the matching control — `.checked` for checkbox/radio, a coerced number for number/range, `.value` otherwise. |
| `schemaToValidator(schema)` | Compiles a JSON Schema into a `(values) => errors` function via `@amritk/runtime-validators`. |
| `Field`, `FieldValue`, `FieldValues`, `FormConfig`, `Form`, `FormValidate`, `FormErrors` | Exported types. |

Validation accepts **either** a plain `(values) => errors` function **or** a JSON Schema, which is validated through `@amritk/runtime-validators` (eval-free, CSP-safe) — so a form dogfoods the mjst validation stack:

```tsx
import { createForm } from '@amritk/mini/forms'

const form = createForm({
  initialValues: { email: '' },
  validate: { type: 'object', properties: { email: { type: 'string', minLength: 1 } }, required: ['email'] },
  onSubmit: (values) => save(values),
})

const view = () => (
  <form onSubmit={form.handleSubmit}>
    <input ref={form.bind('email')} placeholder="email" />
    <span show={() => Boolean(form.field('email').error())}>{() => form.field('email').error()}</span>
    <button type="submit" disabled={form.isSubmitting}>Save</button>
  </form>
)
```

`@amritk/runtime-validators` is an **optional peer dependency** — install it only if you validate with schemas.

### Data (`@amritk/mini/query`)

A thin adapter that bridges [`@tanstack/query-core`](https://tanstack.com/query) observers to mini signals — so caching, deduplication, retries, and invalidation come from TanStack Query rather than a bespoke resource primitive (mirroring how `solid-query` wraps query-core).

| Export | Purpose |
|:---|:---|
| `createQuery(client, options)` | Subscribes a `QueryObserver` and exposes `{ result, data, error, status, isPending, isLoading, isFetching, isSuccess, isError, refetch }` as signals. Call it inside a component/`effectScope` — the subscription is cleaned up with the scope. `options` may be a getter, so the query key can depend on signals (`() => ({ queryKey: ['user', id()] })`) and refetch when they change. |
| `QueryResult` | Exported type. |

`@tanstack/query-core` is an **optional peer dependency** — install it only if you use `/query`.

### Build guard (`@amritk/mini/vite`)

A Vite plugin that catches the one footgun of the [reactivity rule](#the-reactivity-rule): calling a signal in a binding (`disabled={streaming()}`) freezes its value at creation instead of tracking it. Because the call happens before `jsx()` runs, neither the runtime nor the type checker can see the mistake — so it is caught in the source, by parsing it.

| Export | Purpose |
|:---|:---|
| `catchCalledSignals(options?)` | A Vite plugin. Scans each `.tsx` module on every edit and flags a binding whose whole value is a single zero-argument call — both attributes (`disabled={streaming()}`, and so `show`/`class`/`style`/component props like `<For each={items()}>`) and children (`<span>{count()}</span>`). **Warns** in the dev server and **fails** `vite build` — one plugin for both the editor loop and the CI gate. Bare getters, thunks, and handlers are a different shape and never match; a `catch-called-signals-ignore` comment opts out a deliberate case. Pass `{ failOnError }` to force the severity. |
| `findCalledSignalBindings(source)` | The underlying scanner (returns `CalledSignalBinding[]`), for a bespoke lint command or editor integration. |
| `CatchCalledSignalsOptions`, `CalledSignalBinding` | Exported types. |

```ts
import { defineConfig } from 'vite'

import { catchCalledSignals } from '@amritk/mini/vite'

export default defineConfig({
  plugins: [catchCalledSignals()],
})
```

`vite` and `typescript` are **optional peer dependencies** — needed only by this subpath, so the `.` core stays dependency-free.

---

## Usage

Point your compiler at mini's JSX runtime — either per file or in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@amritk/mini"
  }
}
```

Then build UI from signals:

```tsx
import { signal, list } from '@amritk/mini'

const Counter = (): HTMLElement => {
  const count = signal(0)
  return (
    <button type="button" onClick={() => count(count() + 1)}>
      clicked {() => count()} times
    </button>
  )
}

document.body.appendChild(Counter())
```

Each module has its own colocated test file (`*.test.ts` / `*.test.tsx`) — read those for canonical examples.

---

## License

[MIT](../../LICENSE)
