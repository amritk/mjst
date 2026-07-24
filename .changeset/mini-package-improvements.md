---
'@amritk/mini': minor
---

Flow/router state preservation, correctness fixes across the binding layer, and
form ergonomics.

**Fixes**

- Flow and router components no longer rebuild their subtree when a derived
  condition changes without flipping which branch wins. `renderChild` now gates
  the swap on factory identity, so `<Show when={() => count() > 5}>`,
  `<Switch>`, `<Dynamic>`, and `<RouterView>` keep the mounted node (and its
  focus/scroll/input state) across unrelated signal changes; a same-route param
  change like `/users/1 → /users/2` preserves the view.
- `watch` runs its callback untracked, so a signal read inside the callback no
  longer becomes a dependency that re-fires the watcher (matches Vue's `watch`).
- The two-way binds (`bindValue`/`bindSelect`/`bindChecked`) attach their DOM
  listeners inside an effect, so disposing the enclosing `effectScope` detaches
  them too — previously that path stopped only the signal→element effect and
  leaked the element→signal listeners.
- Number form fields report `NaN` and render blank when cleared instead of
  snapping to `0`, so a `required`/`minimum` check can tell empty from zero.
- `createQuery` re-seeds the optimistic result when a reactive query key
  changes, so `data`/`isPending` reflect the new key immediately, and `refetch`
  forwards its options to query-core.
- Hash-mode `navigate` refreshes the route signal even when the target equals
  the current hash (which fires no `hashchange`), and `RouterView` throws a
  clear error when a matched route's view is not a function.
- `list` warns instead of silently dropping rows when two items share a key.

**Features**

- `@amritk/mini/forms` adds a `<Field>` component that renders a label, control,
  and live validation error wired to a `createForm` field in one element;
  `createForm` gains `setError`/`submitError` (with auto-clear on edit and a
  captured `onSubmit` rejection), `reset` now clears submitting/error state, and
  `form.bind` handles `<select>`. The exported field-state type is renamed
  `Field` → `FieldState` to free the name for the component.
- `<For>` accepts a `fallback` for the empty-list state.
- `<Link>` gains a reactive `to`, `active`/`activeClass`/`aria-current` for the
  current link, and `target`/`rel`/`title`/`id`/`style` passthrough.
- The `@amritk/mini/vite` reactivity guard now catches a called signal anywhere
  inside a non-getter attribute or child value — ternaries, logical
  expressions, `style`/`class` object literals, template literals — not only the
  whole-value-is-one-call shape, while still never flagging a call inside a
  getter.
