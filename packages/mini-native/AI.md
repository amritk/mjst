# @amritk/mini-native — notes for AI coding agents

A React-Native-shaped UI runtime on `@amritk/mini`'s model: real host nodes built
once, mutated forever by signals, no virtual tree. This file is the fast path for
an LLM; the full reference is [README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions. There is **no virtual DOM, no
> diffing, no re-render, no hooks**. A component function runs once and returns
> the host node it built.

## The two rules that trip up every agent

**1. Reactivity is decided by value shape at runtime**, because there is no
compiler analysing your code:

```tsx
<view show={visible}>              {/* ✅ reactive — tracks forever      */}
<view show={visible()}>            {/* ❌ STATIC — frozen at creation!   */}
<text>{() => `hi ${name()}`}</text> {/* ✅ reactive derived text          */}
<text>{name()}</text>              {/* ❌ static text, frozen            */}
<view onTap={() => n(n() + 1)}>    {/* ✅ calls are fine inside handlers */}
```

**2. The elements are native, not HTML.** `JSX.IntrinsicElements` is
`view | text | image | scroll-view | input`. There is no `<div>`, and there never
will be — the DOM is a *preview target* here, not the real one. Writing
`<div>`/`<span>`/`<p>` is the single most common mistake; it will not compile.

## Setup — a host must be installed first

```tsx
import { mount, setHost, signal } from '@amritk/mini-native'
import { createDomHost, domRoot } from '@amritk/mini-native/hosts/dom'

setHost(createDomHost())            // once, before anything renders

const Counter = () => {
  const count = signal(0)           // read: count() · write: count(next)
  return (
    <view onTap={() => count(count() + 1)}>
      <text>{() => `tapped ${count()} times`}</text>
    </view>
  )
}

const dispose = mount(domRoot(document.body), Counter) // dispose() tears it down
```

`requireHost()` throws if `setHost` was never called — that is a boot-order
mistake, not a recoverable condition. In tests, `clearHost()` between cases.

JSX config in the consuming package (this is **not** the React runtime):

```jsonc
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@amritk/mini-native" } }
```

## Element props

Common to every tag: `children`, `ref`, `show`, `class`, `style`, `id`, `testId`,
`key`, plus `onTap` / `onLongPress` / `onFocus` / `onBlur`. Gestures are the
native idiom — there is no `onClick`. Per tag: `text` takes `lines`; `image`
takes `src`/`alt`/`fit`/`onLoad`/`onError`; `scroll-view` takes
`direction`/`onScroll`; `input` takes
`value`/`placeholder`/`disabled`/`readonly`/`multiline`/`keyboard`/`onInput`/`onChange`.

`show` hides in place (the host's `setVisible`). To add and remove nodes
structurally, use the control-flow components.

## Building UI

- **`mount(container, Component)`** — the only correct entry point. It opens the
  scope that owns every effect and `onCleanup` in the tree.
- **`list(container, items, key, create)`** — keyed collections; `items` is a
  getter, and `container` must be owned solely by the list.
- **`<Show>` / `<For>` / `<Dynamic>`** from `@amritk/mini-native/flow` — each
  renders into a wrapper the host supplies, so it stays platform-neutral.
- **`bindText` / `bindProp` / `bindShow` / `bindValue`** — imperative bindings
  for `ref` code. There is no `innerHTML` sink on any target, by design.

## Subpath entry points

| Import | Purpose |
|---|---|
| `@amritk/mini-native` | signals, `mount`, `list`, binds, `setHost`, JSX types |
| `@amritk/mini-native/flow` | `Show` / `For` / `Dynamic` / `defaultKey` |
| `@amritk/mini-native/host` | the `Host` contract, for writing a renderer |
| `@amritk/mini-native/hosts/dom` | `createDomHost`, `domRoot` — web preview |
| `@amritk/mini-native/hosts/lynx` | `createLynxHost`, `lynxRoot` — Lynx Element PAPI |
| `@amritk/mini-native/hosts/memory` | `createMemoryHost` — plain objects, for tests |
| `@amritk/mini-native/hosts/memory/serialize` | `serializeMemoryTree` for assertions |
| `@amritk/mini-native/hosts/memory/dispatch` | `dispatchMemoryEvent` to fire handlers |

## Porting to a new platform

Implement `Host` (about 15 functions) and pass it to `setHost` — that is the
whole job, there is no reconciler to port. Start from
`hosts/create-memory-host.ts`. The target's node tree must be **mutable**;
`flush` is optional and only for targets that batch (the runtime coalesces a
whole tick into one commit). Hosts must tolerate unknown event names.

Install: `bun add @amritk/mini-native` (or npm/pnpm/yarn).
