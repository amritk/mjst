---
'@amritk/mini': minor
---

Fix five defects in the JSX runtime and the bindings, all found by auditing the sibling package `@amritk/mini-native` and confirmed to exist here too.

- **A style write no longer un-hides what `show` hid.** `bindShow` writes inline `display` and applying a style bag replaces the inline style wholesale, so an element carrying both props showed itself again on the next style update — and which one won came down to the order the attributes happened to be typed in. The two intents are now remembered apart: hiding wins while it is in effect, and showing the element again restores exactly the `display` its own style asked for rather than a hardcoded default. Only elements something has hidden carry any bookkeeping, so a plain `style` prop pays one lookup miss.
- **Bare numeric style values are no longer silently dropped.** `style={{ width: 100 }}` produced empty CSS, because `100` is not a valid length. A bare number now means pixels, as it does in React, Preact, and Solid — except for the properties CSS treats as unitless (`opacity`, `zIndex`, `flex`, `lineHeight`, and friends) and custom `--*` properties, which pass through untouched.
- **`class` flattens nested arrays.** `['a', ['b', 'c']]` resolved to `'a b,c'`. Falsy entries still drop out at every level, including a falsy `0` from untyped input, which would otherwise have become the class name `"0"`.
- **`key` reaches a component again.** JSX reserves `key`: the transform hoists it out of the props object before a component is ever called, so `<For each={rows} key={byId}>` silently fell back to `defaultKey` — a bug that surfaces as rows mysteriously not updating rather than as an error. It is forwarded for component tags now, and still ignored for element tags, where there is no keying at the JSX level.
- **`bindValue` keeps a write that lands mid-IME-composition.** The element is deliberately left alone while an IME is composing, but `compositionend` then set the signal *from* the element, so the two agreed again and the tracking effect had nothing left to re-apply — an app clearing a field mid-composition lost the write entirely. Such a write is now deferred and applied at the end, where it wins over the candidate text. `bindSelect` and `bindChecked` have no equivalent hole; neither declines a write in the first place.

The core's gzipped size budget moves from 3050 to 3200 bytes to cover these and the `list` fix (measured: 3137).
