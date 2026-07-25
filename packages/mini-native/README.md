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

The one prop this rule does not reach is `input multiline`, which is structural: it decides which control the host *builds*, and no target can turn an input into a textarea afterwards. It is typed as a plain boolean so a getter cannot silently apply once and then never again.

Effects run synchronously on write. The flush scheduler already collapses a burst of writes into a single commit, but not the property writes leading up to it — wrap related writes in `batch` when each one would otherwise cross the bridge on its own.

---

## The element vocabulary is native, not HTML

`JSX.IntrinsicElements` is `view | text | image | scroll-view | input` — not `HTMLElementTagNameMap`. That inversion is load-bearing: it keeps the DOM library out of the core entirely, and it makes the browser a **preview target for a native app** (`view` renders as a `<div>`, `text` as a `<span>`) rather than the real target that native approximates.

| Tag | Props beyond the common set |
|:---|:---|
| `view` | — (element children only) |
| `text` | `lines` (line clamp) — the only tag that accepts a text run |
| `image` | `src`, `alt`, `fit`, `onLoad`, `onError` — a leaf, no children |
| `scroll-view` | `direction`, `onScroll` (element children only) |
| `input` | `value`, `placeholder`, `disabled`, `readonly`, `multiline`, `keyboard`, `onInput`, `onChange` — a leaf, no children |

Common to all: `ref`, `show`, `class`, `style`, `id`, `testId`, `key`, and the gestures `onTap` / `onLongPress` / `onFocus` / `onBlur`. Event names are the native idiom — tapping is the gesture that actually exists on a device — and the DOM host maps them back onto mouse events. There is no delegation and no capture phase, because native targets have no bubbling to hook into.

`children` is **per tag**, not common, because what a tag may contain differs sharply. Only `text` accepts a text run; `view` and `scroll-view` take elements only; `image` and `input` are leaves. That is not pedantry — Lynx will not render a text run outside a `<text>`, so `<view>hello</view>` builds a screen that silently comes up blank on a device while looking perfectly fine in the browser preview. It is a compile error instead.

Handlers are typed `unknown` by default, since only the installed host knows what an event is. Fill them in once for the target you ship:

```ts
declare module '@amritk/mini-native' {
  interface NativeEventMap { tap: MouseEvent; input: InputEvent }
}
```

---

## API

### Core (`@amritk/mini-native`)

| Export | Purpose |
|:---|:---|
| `signal(initial)` | A writable signal. Call with no argument to read, with one to write. |
| `computed(fn)` / `effect(fn)` / `effectScope(fn)` | Re-exported from [alien-signals](https://github.com/stackblitz/alien-signals), so nothing else in a codebase imports it directly. |
| `batch(fn)` | Groups several writes into one propagation pass, so dependent effects run once rather than once per write. |
| `watch(get, callback, options?)` | Runs `callback` when the tracked value **changes**, skipping the initial run unless `{ immediate: true }`. The callback runs untracked. |
| `untrack(get)` | Reads without subscribing — for an effect that needs a value but must not re-run when it changes. |
| `onCleanup(fn)` | Teardown registered against the enclosing scope. |
| `setHost(host)` / `requireHost()` / `clearHost()` | Install, read, and reset the renderer. One host per JavaScript context. |
| `mount(container, component)` | Application root: runs `component` in an owning scope, inserts its node, returns a `dispose` that removes the node and tears the scope down. |
| `list(container, items, key, create)` | The only reconciler — keyed collections over four host operations, move-minimal. |
| `renderChild(wrapper, select)` | Reactive single-slot swap; the base of the control-flow components. |
| `bindText` / `bindProp` / `bindShow` / `bindValue` | Imperative bindings for `ref` code. `bindValue` is two-way and holds writes during IME composition. |
| `ELEMENT_TAGS`, `ElementProps`, `ElementTag`, `NativeEventMap` | The element vocabulary, at runtime and in types. Augment `NativeEventMap` to type your handlers. |
| `Host`, `HostElement`, `HostNode`, `HostText`, `Component`, `MaybeReactive`, … | The renderer contract and the shared types. |

### Control flow (`@amritk/mini-native/flow`)

| Export | Purpose |
|:---|:---|
| `<Show>` | Two-way conditional. A function child receives a **getter** for the narrowed value, so a truthy→truthy change updates in place instead of rebuilding the branch. |
| `<Switch>` / `<Match>` | Multi-way conditional, first truthy branch wins. Losing branches are never built. |
| `<Dynamic>` | The general subtree swap both of the above are built on. |
| `<For>` | Keyed collections, backed by `list`. Key on item identity; this is the right default. |
| `<Index>` | Position-keyed collections, for values that can legitimately repeat. Each row receives a **getter** for whatever item currently occupies its slot. |
| `defaultKey` | The identity function `For` uses when no `key` is given. |

Each renders into a wrapper the host supplies via `createFlowHost` — a `display: contents` div on the web, an ordinary container view natively.

`For` and `Index` differ in what identifies a row, and the choice is load-bearing. `For` keys on the item, so a row follows its data through a reorder and keeps its focus and input state; two items with the same key are reported and dropped. `Index` keys on the slot, which is what makes `['red', 'red', 'blue']` renderable — but a row then belongs to the position rather than to the item, so anything living inside it stays behind when the data moves.

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
- **`createElement` receives the prop bag**, for the few props that decide what gets *built* rather than how it behaves. Ignore the argument if your target has none.
- **A style write must not disturb visibility.** `setVisible` and `setStyle` are easiest to implement through one channel — inline `display` on the web, inline styles on Lynx — and then a wholesale style replacement quietly un-hides a hidden element. If the two share a channel, remember the visibility and re-assert it. Both shipped hosts show the shape.
- **A bare number in a style bag means density-independent pixels**, the React Native convention, and adding the unit is the host's job. `src/hosts/to-style-text.ts` does it for the shipped hosts.
- **`flush` is optional.** Define it if your target batches. The runtime never calls it per mutation — a whole tick of changes coalesces into a single commit, against whichever host is installed when that commit runs.
- **Hosts must tolerate unknown event names.** `bindValue` subscribes to `compositionstart` / `compositionend`, which native targets never fire.

---

## Known gaps

Deliberate omissions and unbuilt work, listed so nobody has to rediscover them.

Deliberate:

- **No raw-markup sink, ever.** There is no `bindHtml` equivalent anywhere in the host contract, so bound data cannot inject elements on any target.
- **No `bindClass`.** The reactive `class` prop covers it and keeps the contract smaller.
- **No fragments.** Every piece of UI is one root element, which is also how a native view tree works. The cost is a real container view per component.

Not built yet:

- **No accessibility props.** `image alt` is the only one. This is the largest gap and the next thing worth doing — it is far cheaper to design in while the vocabulary is five tags.
- **No virtualised list.** `For` over ten thousand rows creates ten thousand host elements; Lynx ships a recycler this should bind to.
- **No gestures beyond tap and long-press** — no pan, swipe, or pinch — and no animation seam, so an animation is a bridge write per frame.
- **No context, portal, or error boundary.**
- **No safe-area, dimensions, or colour-scheme signals.**
- **No router, forms, or query.** [`@amritk/mini`](../mini) has all three; forms and query are close to platform-free, and the router's matching half is pure — only navigation needs a native nav-stack shim rather than `window.history`.

---

## License

MIT
