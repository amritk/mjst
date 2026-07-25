# `@amritk/mini-native` — audit

An assessment of the pre-alpha native runtime: what is broken today, what is
missing relative to `@amritk/mini`, and what a native-shaped framework needs
that neither package has yet.

Every defect below was reproduced against the package's own hosts (memory, DOM
via happy-dom, Lynx via the fake PAPI engine) before being written down. The
existing suite — 43 tests across 6 files — passes; none of these are covered by
it.

Measured core size at the time of writing: `.` entry 6.5 KB raw / **2.5 KB
gzipped**, `/flow` 2.4 KB gzipped, DOM host 731 B, Lynx host 768 B.

---

## 1. Defects

### 1.1 `style` and `show` fight over the same slot — on every host

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

`style={{ width: 100 }}` produces empty `cssText` — `setProperty('width','100')`
is invalid CSS and is discarded. The type permits numbers and the doc comment
says "add units yourself", but React Native's convention (bare numbers are
density-independent pixels) is what every user of a native-shaped API will
reach for, and the failure is silent.

Pick one and enforce it: either the DOM host appends `px` for length properties
(matching RN, keeping the preview honest), or `StyleValue` drops `number` from
its union so the compiler catches it.

### 1.9 Smaller confirmed issues

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

| | `mini` | `mini-native` |
|:---|:---:|:---:|
| `batch` | ✅ | ❌ |
| `watch` (change-only, untracked callback) | ✅ | ❌ |
| `Switch` / `Match` | ✅ | ❌ |
| `Show` narrowed-value getter | ✅ | ❌ |
| move-minimal keyed diff | ✅ | ❌ |
| duplicate-key warning | ✅ | ❌ |
| router | ✅ | ❌ |
| forms (`createForm`, schema validation) | ✅ | ❌ |
| query (`@tanstack/query-core`) | ✅ | ❌ |
| called-signal lint shipped to consumers | ✅ (`/vite`) | ❌ |
| core size-budget test | ✅ | ❌ |
| import-boundary test | ✅ | ❌ |
| typed events | ✅ (`TargetedEvent`) | ❌ (`unknown`) |
| `bindClass` / `bindAttr` / `bindChecked` | ✅ | ❌ (partly by design) |

`batch` is the notable core omission: without it a burst of writes runs every
dependent effect synchronously, and only the *flush* is coalesced — so 50 writes
produce 1 commit but 50 property writes. `watch` is the notable app-level one;
"run a side effect when this changes, but not on setup, and don't track what the
callback reads" is unavoidable in real apps and cannot be expressed with `effect`
alone.

Of the three feature subpaths, `forms` and `query` are almost entirely
platform-free and could be ported nearly as-is. The router's matching half
(`match-route`, `parse-query`, `strip-base`) is pure; only the history half needs
a native nav-stack shim — as the README already notes.

### Test coverage

6 test files, 43 tests. Nothing covers `For`, `Dynamic`, `renderChild`, any of
`bind/*`, `defaultKey`, `resolveClass`, `toFactory`, `toGetter`, `runDetached`,
`scheduleFlush`, or the memory host itself. Several of the defects above sit
squarely in that gap — 1.2 lives in `renderChild`, 1.4 in `bind/bind-value`,
1.3 and 1.6 in the untested branches of `list`.

There is also no equivalent of mini's `core-size-budget.test.ts` or
`import-boundary.test.ts`. Both matter more here, not less: the whole premise is
that the core contains no platform, and only the tsconfig currently enforces it.

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

**Typed events.** Every handler is `(event: unknown) => void`. Because the host
is pluggable, this wants an augmentable interface each host can fill in, not a
fixed map.

---

## 4. Recommendations

### P0 — correctness, small diffs

1. Separate visibility from the style channel in the `Host` contract (§1.1).
2. Memoise `select` in a `computed` inside `renderChild` (§1.2).
3. Register `bindValue`'s listeners with `onCleanup` (§1.4).
4. Warn and drop on duplicate keys in `list` (§1.3).
5. `setHost` resets `flushQueued`; the queued microtask reads the host at flush
   time (§1.5).
6. Port mini's two-ended keyed diff into `list` (§1.6).
7. Fix or withdraw `fit` / `lines` / `direction` / `multiline` /
   `keyboard=phone` on the DOM host, and correct the comments that claim they
   already work (§1.7, §1.9).
8. Decide the numeric-style policy and enforce it in types or in the host
   (§1.8).

Items 2–6 are ports of code that already exists and is already tested in
`mini`. Item 1 is the only one needing a design decision.

### P1 — parity and confidence

9. Export `batch`, `watch`, and an `untrack` built on the existing
   `runDetached`.
10. Add `Switch` / `Match`, an `Index` (non-keyed) companion to `For`, and the
    `Show` narrowed-value getter.
11. Fill the test gaps above; add a core size-budget test (lock in ~2.5 KB
    gzipped) and an import-boundary test asserting no host is reachable from
    `.`.
12. Ship the called-signal check to consumers — the footgun is identical here
    and the existing `findCalledSignalBindings` is host-agnostic.
13. Make handler types augmentable per host.

### P2 — the native story

14. Accessibility props across the vocabulary, and in the `Host` contract.
15. A virtualised list bound to Lynx's recycler.
16. Full gesture set; a `Host.animate` seam.
17. Context/provide, `Portal`, error boundaries.
18. Safe-area, dimensions, and colour-scheme signals.
19. Port `forms` and `query` (near-free); router with a nav-stack shim.
20. A benchmark, mirroring the js-framework-benchmark example `mini` grew — the
    reconciler changes in P0 want a number attached.

### On the README

The "Known gaps" section is good practice and should stay, but it currently
under-reports: `fit`, `lines`, and `direction` are no-ops it does not mention,
and the reconciliation note describes better behaviour than the code delivers.
Both are worth correcting alongside the fixes.
