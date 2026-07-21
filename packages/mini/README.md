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

`@amritk/mini` is a minimal UI layer built on [alien-signals](https://github.com/stackblitz/alien-signals): fine-grained reactivity plus a small, capped set of DOM helpers and a compilerless JSX runtime.

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
| `watch(get, cb)` | Fire `cb(value, previous)` on change, **skipping** the initial run — mini's `watch`. |
| `onCleanup(fn)` | Register teardown to run when the enclosing `effectScope` is disposed. |
| `Signal<T>`, `ReadonlySignal<T>` | Types for the two halves of a signal. |

### DOM bindings (`@amritk/mini`)

Each binding ties one node property to a signal-reading getter and returns the effect's stop function. They write through `textContent`, attributes, and `classList` — never `innerHTML` — so bound data cannot inject markup.

| Export | Purpose |
|:---|:---|
| `bindText(node, get)` | Keep `node.textContent` in sync. |
| `bindAttr(node, name, get)` | Keep an attribute in sync (`false`/`null` removes it, `true` sets it bare). |
| `bindClass(node, name, get)` | Toggle a single class. |
| `bindShow(node, get)` | Show/hide via inline `display`. |
| `bindValue(node, model)` | Two-way bind a text input/textarea to a string signal — mini's `v-model`. |
| `bindHtml(node, sanitize, get)` | The **one** sanctioned `innerHTML` sink; the sanitizer is a required argument at every call site. |

### Structure (`@amritk/mini`)

| Export | Purpose |
|:---|:---|
| `template(html)` | Parse a static HTML string once; returns a clone factory that also collects `data-ref` nodes. |
| `list(container, items, key, create)` | Keyed reactive list: one node per key, disposed when its key leaves. |

### JSX runtime (`@amritk/mini/jsx-runtime`, `@amritk/mini/jsx-dev-runtime`)

The automatic runtime TypeScript targets when a package sets `"jsx": "react-jsx"` and `"jsxImportSource": "@amritk/mini"`. Exposes `jsx`, `jsxs`, `jsxDEV`, and the `JSX` namespace, plus the `Component`, `MaybeReactive`, `MiniChild`, `MiniChildren`, and `TargetedEvent` types.

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
