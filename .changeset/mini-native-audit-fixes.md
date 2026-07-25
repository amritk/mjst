---
'@amritk/mini-native': minor
---

Fix every defect found in the pre-alpha audit (`docs/mini-native-audit.md`), and close the parity gaps against `@amritk/mini`. Pre-alpha, so the breaking pieces ride a minor.

**Correctness**

- **`show` and `style` no longer fight.** Both real hosts expressed visibility and style through the same channel, so a style write quietly un-hid a hidden element — and a *static* style did it too, depending on the order the props happened to be written in. Visibility is now a documented `Host` invariant, and both hosts remember it and re-assert it after a style write.
- **`Show` and `Dynamic` stop rebuilding their branch on every condition tick.** `renderChild` memoises the selection in a `computed`, so the swap fires only when the chosen factory actually changes. A truthy→truthy change no longer tears down a subtree that did not logically change — no lost focus, no spurious `onCleanup`, no full rebuild across the bridge.
- **`list` is move-minimal.** Ported mini's two-ended keyed diff onto the host operations. Removing an item from the middle was re-inserting every row after it (5 host calls out of 10 rows) and moving the head to the tail was re-inserting everything (9); both are now 0 and 1. A full clear goes through one `clear` instead of N removes.
- **Duplicate list keys warn and drop** rather than silently collapsing two rows onto one node.
- **`bindValue` no longer leaks its listeners.** They attach from inside an effect, so the documented `ref`-plus-scope teardown detaches all three.
- **A queued flush commits the host installed when it runs**, not the one captured when it was scheduled — swapping hosts mid-tick was flushing the outgoing host and never the incoming one.
- **`key` reaches a component.** JSX reserves `key` and the transform hoists it out of props before the component is called, so `<For each={rows} key={byId}>` was silently falling back to `defaultKey`. It is forwarded for component tags now, and still ignored for elements.

**The DOM preview actually previews**

`image fit`, `text lines`, and `scroll-view direction` were rendering as meaningless attributes — a `scroll-view` did not scroll and a clamped text did not clamp. They map to real styles now, kept in a host-owned layer so a user `style` cannot wipe them. `input multiline` builds a `<textarea>` (the `Host` contract passes the prop bag to `createElement`, which is what makes a structural prop expressible), and `keyboard="phone"` maps to `type="tel"` instead of an invalid type that degraded to text.

**Style numbers mean pixels**

A bare number in a style bag is now density-independent pixels on every target, matching React Native, with the host adding the unit and the usual unitless properties left alone. `{ width: 100 }` used to produce empty CSS.

**New API**

- `batch`, `watch`, and `untrack`.
- `Switch` / `Match`, and `Index` for collections whose values can legitimately repeat — each row gets a getter for whatever occupies its slot, so the node stays put and updates in place.
- `Show`'s function child receives a getter for the narrowed value.
- `NativeEventMap`, an augmentable interface so an app can type its handlers once against the host it ships.

**Types**

`children` moved from the common props to the individual tags: only `text` accepts a text run, `view` and `scroll-view` take element children, and `image` and `input` are leaves. `<view>hello</view>` was a screen that came up blank on Lynx while looking fine in the browser preview; it is a compile error now. `class` also flattens nested arrays, and `multiline` is a plain boolean because it is structural and static.

**Tests**

Every module has tests now, each defect above has a regression test, and there are two structural tests: an import-boundary test asserting no host or flow module is reachable from the `.` entry, and a size-budget test on the bundled, gzipped core.
