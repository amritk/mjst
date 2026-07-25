<div align="center">

# @amritk/mini-native

**A React-Native-shaped UI runtime on mini's model: real host nodes created once, mutated forever by signals, with no virtual tree in between.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/mini-native?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![size](https://img.shields.io/badge/deps-1%20(alien--signals)-f97316?style=flat-square)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/mini-native` renders a component tree to a **native view tree**, the DOM, or plain objects — decided entirely by which **host** is installed. It is [`@amritk/mini`](../mini) with the browser taken out of the core: same signals, same compilerless JSX, same "build the node once and mutate it forever" model, but every platform call goes through a `Host` the caller supplies. It ships from the [mjst](../../README.md) monorepo.

**Why a port like this is tractable at all:** the hard part of a React-style native framework is the reconciler — diffing a virtual tree and committing minimal mutations across a bridge. There is none here. JSX builds a host node immediately and signals mutate it in place, so targeting a platform means implementing one `Host` (about 15 functions) and nothing else.

That leaves one hard requirement for a new target: **its node tree must be mutable**. A renderer whose tree is immutable and re-committed on every change (React Native's Fabric, for instance) is a poor fit, because every attribute write would become a whole-tree commit.

---

## Installation

```bash
npm install @amritk/mini-native
# or
pnpm add @amritk/mini-native
# or
yarn add @amritk/mini-native
# or
bun add @amritk/mini-native
```

Point the JSX transform at the runtime in your `tsconfig.json`:

```jsonc
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@amritk/mini-native" } }
```

---

## Quick start

```tsx
import { mount, setHost, signal } from '@amritk/mini-native'
import { createDomHost, domRoot } from '@amritk/mini-native/hosts/dom'

setHost(createDomHost()) // once, before anything renders

const Counter = () => {
  const count = signal(0)
  return (
    <view onTap={() => count(count() + 1)}>
      <text>{() => `tapped ${count()} times`}</text>
    </view>
  )
}

const dispose = mount(domRoot(document.body), Counter)
```

Swap `createDomHost()` for `createLynxHost()` and the same tree runs on a device. Nothing above the host line changes.

---

## The reactivity rule

There is no compiler analysing your expressions, so reactivity is decided by **value shape at runtime**:

- A **function-valued** prop, child, or `show` is reactive — re-applied whenever the signals it reads change.
- Any **other value** is static — applied once at creation, never again.

Signals are zero-argument functions, so passing one **without calling it** is already a live binding:

```tsx
<view show={visible}>          {/* reactive — tracks forever      */}
<view show={visible()}>        {/* STATIC — frozen at creation!   */}
<text>{() => `${count()}`}</text>  {/* reactive derived text       */}
```

---

## The element vocabulary is native, not HTML

`JSX.IntrinsicElements` is `view | text | image | scroll-view | input` — not `HTMLElementTagNameMap`. That inversion is load-bearing: it keeps the DOM library out of the core entirely, and it makes the browser a **preview target for a native app** (`view` renders as a `<div>`, `text` as a `<span>`) rather than the real target that native approximates.

| Tag | Props beyond the common set |
|:---|:---|
| `view` | — |
| `text` | `lines` (line clamp) |
| `image` | `src`, `alt`, `fit`, `onLoad`, `onError` |
| `scroll-view` | `direction`, `onScroll` |
| `input` | `value`, `placeholder`, `disabled`, `readonly`, `multiline`, `keyboard`, `onInput`, `onChange` |

Common to all: `children`, `ref`, `show`, `class`, `style`, `id`, `testId`, `key`, and the gestures `onTap` / `onLongPress` / `onFocus` / `onBlur`. Event names are the native idiom — tapping is the gesture that actually exists on a device — and the DOM host maps them back onto mouse events. There is no delegation and no capture phase, because native targets have no bubbling to hook into.

---

## API

### Core (`@amritk/mini-native`)

| Export | Purpose |
|:---|:---|
| `signal(initial)` | A writable signal. Call with no argument to read, with one to write. |
| `computed(fn)` / `effect(fn)` / `effectScope(fn)` | Re-exported from [alien-signals](https://github.com/stackblitz/alien-signals), so nothing else in a codebase imports it directly. |
| `onCleanup(fn)` | Teardown registered against the enclosing scope. |
| `setHost(host)` / `requireHost()` / `clearHost()` | Install, read, and reset the renderer. One host per JavaScript context. |
| `mount(container, component)` | Application root: runs `component` in an owning scope, inserts its node, returns a `dispose` that removes the node and tears the scope down. |
| `list(container, items, key, create)` | The only reconciler — keyed collections over four host operations. |
| `renderChild(wrapper, select)` | Reactive single-slot swap; the base of the control-flow components. |
| `bindText` / `bindProp` / `bindShow` / `bindValue` | Imperative bindings for `ref` code. `bindValue` is two-way and holds writes during IME composition. |
| `ELEMENT_TAGS`, `ElementProps`, `ElementTag` | The element vocabulary, at runtime and in types. |
| `Host`, `HostElement`, `HostNode`, `HostText`, `Component`, `MaybeReactive`, … | The renderer contract and the shared types. |

### Control flow (`@amritk/mini-native/flow`)

`<Show>`, `<For>` (keyed, backed by `list`), and `<Dynamic>`. Each renders into a wrapper the host supplies via `createFlowHost` — a `display: contents` div on the web, an ordinary container view natively. `defaultKey` is the identity function `For` uses when no `key` is given.

### Hosts

| Import | Target |
|:---|:---|
| `@amritk/mini-native/hosts/dom` | `createDomHost()` + `domRoot(element)` — the web preview target, the only file in the package that knows what HTML is. |
| `@amritk/mini-native/hosts/lynx` | `createLynxHost(api?)` + `lynxRoot(element)` — drives [Lynx](https://lynxjs.org)'s Element PAPI. Takes the PAPI as an argument, so it is testable against a fake engine. |
| `@amritk/mini-native/hosts/memory` | `createMemoryHost()` — plain objects, no platform. The reference implementation and what the test suite runs against. |
| `@amritk/mini-native/hosts/memory/serialize` | `serializeMemoryTree(node)` — the in-memory tree as an indented string, for assertions. |
| `@amritk/mini-native/hosts/memory/dispatch` | `dispatchMemoryEvent(element, name, event)` — fires a handler on the in-memory tree. |
| `@amritk/mini-native/host` | The `Host` type on its own, for writing a new one. |

---

## Writing a host

Implement `Host` and pass it to `setHost`. Read `src/hosts/create-memory-host.ts` first — it is the shortest complete implementation and exists partly to be that reference. Points worth knowing:

- **`createFlowHost` is separate from `createElement`** because the right wrapper differs per target.
- **`flush` is optional.** Define it if your target batches. The runtime never calls it per mutation — a whole tick of changes coalesces into a single commit.
- **Hosts must tolerate unknown event names.** `bindValue` subscribes to `compositionstart` / `compositionend`, which native targets never fire.

---

## Known gaps

Deliberate omissions, listed so nobody has to rediscover them:

- **No router.** Route matching is pure and portable; the navigation half needs a native nav-stack shim rather than `window.history`.
- **No `Switch`/`Match`.** `Show` and `Dynamic` cover the cases in use, and both are a thin layer over `renderChild`.
- **No raw-markup sink, ever.** There is no `bindHtml` equivalent anywhere in the host contract, so bound data cannot inject elements on any target.
- **No `bindClass`.** The reactive `class` prop covers it and keeps the contract smaller.
- **`input multiline` does nothing in the DOM preview.** The element is created before props are read, so the host cannot switch to a `<textarea>`.
- **Reconciliation is append-ordered.** Rows already in position are never moved, so appends are free and arbitrary reorders converge with more insert calls.

---

## License

MIT
