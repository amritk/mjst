# `@amritk/mini-native` — audit

An assessment of the pre-alpha native runtime: what is broken today, what is
missing relative to `@amritk/mini`, and what a native-shaped framework needs
that neither package has yet.

Every defect below was reproduced against the package's own hosts (memory, DOM
via happy-dom, Lynx via the fake PAPI engine) before being written down.

> **Status: sections 1 and 2 are done.** Every defect in section 1 is fixed and
> carries a regression test, and the section 2 parity gaps are closed apart from
> the three feature subpaths. Section 3 — the native story — is untouched and is
> the roadmap. Each item below is marked with what actually shipped, because the
> reasoning is worth keeping even once the code has moved on.

Core size at the time of the audit: `.` entry 6.5 KB raw / 2.5 KB gzipped,
`/flow` 2.4 KB gzipped, DOM host 731 B, Lynx host 768 B. There is now a
size-budget test holding that line.

---

## 1. Defects

### 1.1 `style` and `show` fight over the same slot — on every host

> **Fixed.** Both real hosts now keep their own visibility bookkeeping and
> re-assert it after a style write, and the rule is written into the `Host`
> contract so the next host cannot rediscover it. The memory host was already
> correct, which is exactly why the existing tests could not see the bug.

`setVisible` writes visibility into the style bag (`display` on both the DOM and
Lynx hosts) and `setStyle` replaces that bag wholesale. So any element carrying
both props loses its hidden state the moment the style is applied.

```tsx
<view show={visible} style={() => ({ width: `${w()}px` })} />
```

DOM host: after `visible(false)` the element is `display: none`; after the next
`w(...)` tick `cssText` is `width: 20px;` and the element is **visible again**.
Lynx host: identical — `{"width":"10px","display":"none"}` becomes
`{"width":"20px"}`.

It is worse than a re-application race, because a *static* style triggers it
too: `applyProp` iterates `Object.entries(props)`, so `<view show={false}
style={{ width: '10px' }} />` never hides at all, while the same element with
the props written in the other order does. Behaviour depends on JSX attribute
order.

This is the most serious finding: `show` is a core prop, it is silently
unreliable, and it fails the same way on both real targets.

**Fix.** Make it a host-contract invariant that visibility is orthogonal to
style — either the host keeps its own visibility flag and re-applies it after
any `setStyle` (cheapest, no runtime change), or `setVisible` stops using the
style channel entirely (a class on the web, a dedicated attribute natively).
Whichever is chosen belongs in `host.ts` as a documented rule, since every
future host will hit it.

### 1.2 `Show` / `Dynamic` rebuild the branch on every condition tick

> **Fixed.** `renderChild` memoises the selection in a `computed`, and `Show`
> builds its branch factory once so the reference is stable. `Show`'s function
> child now also receives a getter for the narrowed value, so a truthy→truthy
> change updates through the getter instead of rebuilding.

`renderChild` runs `select` directly inside the tracking effect. The effect
therefore re-runs on any signal `select` reads, and each re-run disposes the
branch scope and rebuilds the subtree — even when the *selected factory did not
change*.

```tsx
<Show when={user}>{() => { builds++; return <text>hi</text> }}</Show>
// user({name:'a'}) -> user({name:'b'})  ⇒ builds === 2

<Show when={() => count() > 5}>…</Show>
// count(6) -> count(7)                 ⇒ builds === 2
```

Consequences: spurious `onCleanup` firing, input focus / scroll position /
selection lost inside a subtree that did not logically change, and on native a
full subtree teardown-and-rebuild across the bridge for a no-op condition
change.

`mini` fixes exactly this by memoising the selection in a `computed`, and its
`render-child.ts` documents it as a P0 guarantee. The port dropped it. The fix
is essentially one line plus the comment explaining why.

### 1.3 Duplicate keys silently drop rows

> **Fixed.** `list` warns and drops explicitly. `Index` is the supported way to
> render a collection whose values legitimately repeat — see the note in section 4.

`list` calls `live.get(k)`; a repeated key returns the entry already placed, so
the same node is re-inserted (moved) instead of a second row being created.

```tsx
<For each={() => ['red', 'red', 'blue']}>{(t) => <text>{t}</text>}</For>
// renders 2 rows: "red", "blue"
```

`mini`'s `list` detects the collision, `console.warn`s, and drops the row
explicitly. Here it is silent data loss, and it is easy to hit because
`defaultKey` stringifies primitives — any list of non-unique strings or numbers
is affected.

### 1.4 `bindValue` leaks its event listeners

> **Fixed.** The listeners are attached from inside an effect, so disposing the
> enclosing scope detaches them.

`bindValue` registers three listeners (`input`, `compositionstart`,
`compositionend`) through `host.addEventListener` and returns their disposes in
a combined teardown. Nothing registers them with `onCleanup`, so the documented
usage — call it from a `ref` and let the enclosing `effectScope` handle
teardown — leaves all three attached after unmount. Verified: after `dispose()`
the memory host still holds `['input', 'compositionstart', 'compositionend']`.

The signal→element effect *is* cleaned up (it is an ordinary effect in the
enclosing scope), so this presents as a half-disposed binding. On Lynx the
consequence is concrete: the host's per-element dispatcher stays registered on a
detached element.

`mini` avoids this by attaching listeners *inside* an effect, so scope disposal
detaches them; that pattern ports directly.

### 1.5 Swapping the host loses a commit

> **Fixed.** The queued flush reads the installed host when it runs rather than
> closing over it, and `clearHost` no longer clears the queued flag out from under
> a pending commit.

`scheduleFlush` captures `current` at schedule time and `setHost` never resets
`flushQueued`. Install host A, render (queues a flush against A), install host
B in the same tick: A gets the flush, B never does, and B's tree is left
uncommitted.

```
flushes A: 1  B: 0
```

Niche today, but it is exactly the hot-reload and test-isolation path, and
`clearHost` already resets the flag — `setHost` should too, and the microtask
should read the host at flush time rather than closing over it.

### 1.6 The reconciler moves O(n) nodes for a middle removal

> **Fixed.** `mini`'s two-ended keyed diff is ported onto the host operations.
> Measured after: a middle removal costs zero moves and move-to-end costs one, both
> pinned by tests that count host calls rather than asserting on order alone.

The cursor-walk reconciler is correct on every ordering tried, and optimal for
appends, prepends, adjacent swaps, reverses, and move-to-front. Two common cases
are not:

| operation (10 keyed rows) | `insert` calls | optimal |
|:---|---:|---:|
| append one | 1 | 1 |
| prepend one | 1 | 1 |
| swap two adjacent | 1 | 1 |
| move last → first | 1 | 1 |
| reverse | 6 | ~n |
| **remove one from the middle** | **5** | **0** |
| **move first → last** | **9** | **1** |

Removing an item from the middle re-inserts every row after it, because the
cursor desynchronises and never recovers. On the web that is a wasted
`insertBefore`; across a native bridge it is a real call per row, and
delete-from-a-list is one of the most common interactions there is.

`mini` already solved this — its `list.ts` carries a move-minimal two-ended diff
(Vue 2 / Snabbdom shape) that does the middle removal in zero moves and
move-to-end in one. The algorithm is host-agnostic apart from the
`DocumentFragment` batching; porting it costs a few hundred bytes and is
mechanical.

The README's "Reconciliation is append-ordered. Rows already sitting in the
right position are left completely untouched" is not accurate for these cases
and should be corrected either way.

### 1.7 The DOM preview does not preview four documented props

> **Fixed.** `fit`, `lines`, and `direction` map to real styles, and `multiline`
> builds a `<textarea>` — the `Host` contract now passes the prop bag to
> `createElement`, which is what makes a structural prop expressible at all. The
> host keeps these in a style layer of its own so the user's `style` prop cannot
> wipe them.

The DOM host maps only `testId` and `keyboard`. Everything else is set as a
literal attribute, so:

```html
<img src="/a.png" fit="cover">           <!-- object-fit never applied -->
<span lines="2">clamped</span>            <!-- no line clamp -->
<div direction="horizontal"></div>        <!-- does not scroll at all -->
<input multiline="">                      <!-- not a textarea -->
```

Two of these are documented as working: `elements.ts` says `fit`'s "names match
the CSS `object-fit` values the DOM host maps onto", and `create-dom-host.ts`
says a scroll-view's "scrolling itself comes from the `direction` prop, which
maps to an overflow style below" — there is no such mapping below it. Only
`multiline` is listed in the README's known gaps.

This undercuts the package's central pitch. If the browser is a preview target
for a native app, a `scroll-view` that does not scroll and a `text lines={2}`
that does not clamp mean the preview is not one.

### 1.8 Numeric style values vanish on the DOM

> **Fixed.** A bare number now means density-independent pixels on every target,
> matching React Native, with the host adding the unit and the short unitless list
> CSS itself uses.

`style={{ width: 100 }}` produces empty `cssText` — `setProperty('width','100')`
is invalid CSS and is discarded. The type permits numbers and the doc comment
says "add units yourself", but React Native's convention (bare numbers are
density-independent pixels) is what every user of a native-shaped API will
reach for, and the failure is silent.

Pick one and enforce it: either the DOM host appends `px` for length properties
(matching RN, keeping the preview honest), or `StyleValue` drops `number` from
its union so the compiler catches it.

### 1.9 Smaller confirmed issues

> **Mostly fixed.** `keyboard="phone"` maps to `tel`; `class` flattens nested
> arrays; Lynx emits `data-testid` like the DOM host does. The loose-text case is
> now a compile error rather than a Lynx-only silent blank, because container tags
> accept element children only. The blind object child is unchanged in the runtime
> — it is unreachable without casting past the types — but the memory host, which
> is also the test host, now throws instead of corrupting its tree.

- **`keyboard="phone"` emits `type="phone"`** — not a valid HTML input type; it
  silently degrades to `text`. Should map to `tel`.
- **`class` does not flatten nested arrays** — `['a', ['b','c']]` resolves to
  `"a b,c"`.
- **Any object child is inserted blindly.** `appendChildren` treats "typeof
  object" as a host node, so `<text>{someDate}</text>` corrupts the host tree
  with no error and no warning.
- **Lynx: raw text under a non-`text` element.** `<view>plain</view>` creates a
  `raw-text` child directly under a `view`; Lynx only renders `raw-text` inside
  `<text>`, so it silently displays nothing. Worth either wrapping in the host
  or rejecting in the types.
- **Lynx: `testId` is passed through verbatim** as an unrecognised attribute,
  where the DOM host maps it to `data-testid`. It has no test-hook value on
  device.

---

## 2. Missing relative to `@amritk/mini`

| | `mini` | `mini-native` (before) | now |
|:---|:---:|:---:|:---:|
| `batch` | ✅ | ❌ | ✅ |
| `watch` (change-only, untracked callback) | ✅ | ❌ | ✅ |
| `untrack` | ❌ | ❌ | ✅ |
| `Switch` / `Match` | ✅ | ❌ | ✅ |
| `Show` narrowed-value getter | ✅ | ❌ | ✅ |
| position-keyed collection | ❌ | ❌ | ✅ (`Index`) |
| move-minimal keyed diff | ✅ | ❌ | ✅ |
| duplicate-key warning | ✅ | ❌ | ✅ |
| typed events | ✅ (`TargetedEvent`) | ❌ (`unknown`) | ✅ (augmentable) |
| core size-budget test | ✅ | ❌ | ✅ |
| import-boundary test | ✅ | ❌ | ✅ |
| router | ✅ | ❌ | ❌ |
| forms (`createForm`, schema validation) | ✅ | ❌ | ❌ |
| query (`@tanstack/query-core`) | ✅ | ❌ | ❌ |
| called-signal lint shipped to consumers | ✅ (`/vite`) | ❌ | ❌ — see below |
| `bindClass` / `bindAttr` / `bindChecked` | ✅ | ❌ | ❌ — by design |

`batch` was the notable core omission: without it a burst of writes runs every
dependent effect synchronously, and only the *flush* is coalesced — so 50 writes
produced 1 commit but 50 property writes. `watch` was the notable app-level one;
"run a side effect when this changes, but not on setup, and do not track what
the callback reads" is unavoidable in real apps and cannot be expressed with
`effect` alone.

Of the three feature subpaths still missing, `forms` and `query` are almost
entirely platform-free and could be ported nearly as-is. The router's matching
half (`match-route`, `parse-query`, `strip-base`) is pure; only the history half
needs a native nav-stack shim.

The called-signal lint needs no port: `mini`'s `findCalledSignalBindings` is
purely syntactic over `.tsx`, so `@amritk/mini/vite` already catches the identical
footgun in a `mini-native` codebase. What is missing is saying so — either a note
in the README or a re-export, rather than a second copy of the plugin.

### Two things this round turned up that the audit had missed

**`key` never reached a component.** `key` is reserved by JSX: the transform
hoists it out of the props object into the runtime's third parameter before the
component is called, and `jsx` dropped it there. So `<For each={rows} key={byId}>`
silently fell back to `defaultKey` — a bug that surfaces as rows mysteriously not
updating rather than as an error. `jsx` now forwards it for component tags.
`mini` has the same hole; its `for.test.tsx` only ever calls `For({…})` directly,
which is probably why it went unnoticed.

**Position keying cannot be a key function.** The first attempt at the
duplicate-key escape hatch was an `indexKey` helper. It renders the wrong data:
a row is built once and never rebuilt, so inserting at the front leaves every
later slot holding the node built for whatever used to sit there. That is worse
than the warning it was working around. `Index` exists instead — it hands each
row a *getter* for whatever currently occupies its slot, so the node stays and
the bindings inside it update in place.

### Test coverage

Was 6 files / 43 tests, with nothing covering `For`, `Dynamic`, `renderChild`,
any of `bind/*`, `defaultKey`, `resolveClass`, `toFactory`, `toGetter`,
`runDetached`, `scheduleFlush`, or the memory host itself — which is where four
of the section 1 defects lived. Every module now has tests, every defect above
has a regression test, and there are two structural tests: an import-boundary
test asserting no host or flow module is reachable from `.`, and a size-budget
test on the bundled, gzipped core entry. Both matter more here than in `mini`,
because the whole premise is that the core contains no platform and only the
tsconfig was enforcing it.

---

## 3. Missing for a native framework

These are not `mini` parity gaps — `mini` does not have them either — but a
runtime that calls itself React-Native-shaped is measured against them.

**Accessibility.** There are no accessibility props anywhere in the vocabulary.
`image alt` is the only one. No `role`, `accessibilityLabel`,
`accessibilityHint`, `accessible`, no focus order, no live regions. This is the
single largest omission: an inaccessible native app is not shippable in either
app store's practical review climate, and retrofitting it across a vocabulary is
far more expensive than designing it in while the vocabulary is five tags.

**Virtualised lists.** `For` over 10,000 rows creates 10,000 host elements.
Lynx ships a `<list>` element with recycling precisely because this is the
defining native performance problem. A `<VirtualFor>` bound to it — falling back
to plain `For` on the DOM — is the highest-value native-only addition.

**Gestures.** `onTap` and `onLongPress` only. No pan, swipe, pinch, or
touch-start/move/end, so no drag-to-dismiss, no swipe-to-delete, no pull to
refresh — the interactions that make an app feel native.

**Animation.** No story at all. Driving an animation from a signal means one
property write per frame across the bridge. Native runtimes solve this with
declarative, host-driven animation descriptors; this needs at minimum a
`Host.animate` seam so the engine owns the timeline.

**Platform environment.** No safe-area insets, no dimensions/orientation
signal, no colour-scheme (dark mode) signal. Every one of these is reactive
state a host can expose cheaply, and every real app needs all three.

**Context.** With no component instances there is no implicit way to pass
theme, locale, navigation, or auth down a tree — everything is module globals or
prop drilling. A scope-keyed provide/inject built on `effectScope` fits the
model and is small.

**Portal.** Modals, sheets, toasts, and tooltips all need to escape their
parent view. There is no way to render outside the current subtree.

**Error boundaries.** A throw during a component's single run leaves a partially
built tree and no recovery path.

**Fragments.** Deliberately absent, and defensible — but it means every
component costs a real container view on device, which is exactly the flattening
that native performance work targets.

**Typed events.** *Done.* Handlers were `(event: unknown) => void` with no way
to narrow them. Because the host is pluggable, a fixed map would be wrong on
some target, so `NativeEventMap` is an augmentable interface an app fills in once
against the host it ships.

---

## 4. What is left

Sections 1 and 2 are done. What remains is section 3 — the native story — plus a
few loose ends.

### Loose ends

- Port `forms` and `query` from `mini`; both are close to platform-free.
- A router, with a native nav-stack shim standing in for `window.history`.
- Point consumers at `@amritk/mini/vite` for the called-signal check, or
  re-export it, rather than shipping a second copy.
- A benchmark, mirroring the js-framework-benchmark example `mini` grew. The
  reconciler now has a move-minimal guarantee measured in host calls; a wall
  clock number would be better.

### The native story, in priority order

1. **Accessibility props** across the vocabulary and in the `Host` contract.
   Still the largest single omission, and still far cheaper to design in while
   the vocabulary is five tags than to retrofit later.
2. **A virtualised list** bound to Lynx's recycler. `For` over ten thousand rows
   creates ten thousand host elements.
3. **Gestures beyond tap and long-press**, and a `Host.animate` seam so the
   engine owns the timeline instead of taking a bridge write per frame.
4. **Context, `Portal`, and error boundaries.**
5. **Safe-area, dimensions, and colour-scheme signals** — all cheap for a host
   to expose, all needed by every real app.

Fragments stay deliberately absent, at the known cost of one container view per
component. That is the flattening native performance work usually targets, so it
is worth revisiting if a real screen shows the cost.
