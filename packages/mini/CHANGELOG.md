# @amritk/mini

## 0.5.0

### Minor Changes

- 71145da: `list` (and `For`, which wraps it) now reconciles with a move-minimal two-ended
  keyed diff instead of the append-order walk.

  - **Reordering is now O(moves), not O(n).** The previous reconciler was tuned
    for append and replace-the-tail and fell back to an `insertBefore` sweep that
    moved every node after the first mismatch — so a two-row swap or an early-row
    removal touched the whole tail. The new pass closes in from both ends, so
    swapping two rows is two DOM moves, removing an interior row is zero, and a
    reversal is one move per row. Append and replace-the-tail stay a no-move fast
    path, and node identity (focus, scroll, input state) is preserved throughout.
  - **Bulk insertions now batch through a `DocumentFragment`.** A first render,
    a "create many", or an append of many rows touches the live tree once instead
    of once per row; a single-row append (the streaming-transcript hot path) still
    inserts directly, so it does not regress.
  - **A full clear is one DOM operation.** Emptying the list disposes every row
    scope and wipes the container with a single `replaceChildren` instead of
    removing nodes one at a time.
  - **Core `.` size budget raised 2800 → 3050 B gzipped** to fit the reconciler
    work (the bundled core is ~3.0 KB). Subpaths still add zero bytes to `.`, and
    the widget that imports only `.` pays for it once.
  - No API change: same `list(container, items, key, create)` signature, same
    duplicate-key warning, same scope disposal on removal.

- 9a47efa: Flow/router state preservation, correctness fixes across the binding layer, and
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

- edaabaa: `<Show>` can pass the narrowed value to a function child. `<Show when={user}>`
  now accepts `{(user) => …}`, where `user` is a getter with `null`/`undefined`
  removed from its type — so the branch reads the value that satisfied `when`
  without repeating the signal or a non-null assertion. The value arrives as a
  getter, so a truthy→truthy change updates it reactively without rebuilding the
  branch (a focused input inside it survives), and the getter returns the last
  truthy value so a read that races the branch's teardown can never throw. The
  existing node and zero-argument factory child forms are unchanged.

### Patch Changes

- c6cd268: Trim allocations on the hottest render paths, with no change in behaviour.

  - **`jsx`** — iterate props with `for…in` instead of `Object.entries(props)`.
    Element creation is the framework's most-executed path, and `Object.entries`
    allocated an array plus a `[key, value]` tuple for every prop on every element
    built; the `for…in` walk allocates nothing. Props always arrive as a plain
    object literal from the JSX transform, so there are no inherited enumerables to
    guard against.
  - **`resolveClass`** — the object (toggle-map) form now accumulates truthy keys
    in a single loop rather than chaining `entries().filter().map().join()`, which
    allocated three throwaway arrays on every reactive `class` update.
  - **`applyStyle`** — the object form iterates with `for…in` for the same reason,
    dropping the per-update tuple array on every reactive `style` update.

  - **`list`** — the keyed reconciler tracked which keys survived a pass with a
    freshly-allocated `Set` (plus an insert per row) on every update. A monotonic
    pass counter stamped onto each cached entry does the same job — survivor
    detection and the duplicate-key warning — without allocating anything per
    update.

  Both the `./jsx-runtime` entry and the size-budgeted core move by a handful of
  gzipped bytes and stay comfortably within budget.

## 0.4.1

### Patch Changes

- d35a9ab: chore: package bump

## 0.4.0

### Minor Changes

- 37b6bd6: Add `@amritk/mini/vite`, a build-time guard for mini's one compilerless-JSX
  footgun: `attr={signal()}` calls the getter and freezes a plain value at
  creation, where `attr={signal}` binds it reactively. The mistake cannot be
  caught at runtime (props are evaluated before `jsx()` runs) or by the type
  checker (a called signal returns a valid static value), so it is caught in the
  source. `catchCalledSignals()` walks the TypeScript AST in Vite's `transform`
  hook, so it reports live in the dev server — a terminal warning per finding
  (clickable `file:line:column`) plus a non-blocking error overlay — and fails
  `vite build`, one plugin covering both the editor feedback loop and the CI gate.
  Pass `{ overlay: false }` to keep dev feedback in the terminal only. To keep
  false positives near zero it only flags a call to a name it can see is a signal
  (`signal()`/`computed()`, or a `Signal<…>`/`ReadonlySignal<…>` type) — so
  `id={makeId()}` is left alone — across both attributes (`disabled={streaming()}`,
  `show`/`class`/`style`, and component props such as `<For each={items()}>`) and
  children (`<span>{count()}</span>`). Bare getters, thunks, and handlers never
  match, and a `// mini-static-ok` comment opts out a deliberate static read. The
  same `findCalledSignalBindings` core backs the repo's `check:reactivity` CLI
  gate. `vite` and `typescript` are optional peer dependencies of this subpath
  only — the `.` core stays dependency-free.

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- Updated dependencies [1901231]
- Updated dependencies [b4cd20a]
  - @amritk/runtime-validators@0.8.0

## 0.3.0

### Minor Changes

- 1dfbbdf: `<For>` now accepts an `as` prop (with `class`/`style`/`ref`) to render its
  rows into a real element instead of the default `display: contents` host. This
  closes the one place `For` couldn't slot in: a `divide-y`-style list, whose
  `& > :not([hidden]) ~ :not([hidden])` separators only match the container's
  _direct_ children — the `display: contents` wrapper hid the rows one level too
  deep, so the borders landed between hosts, not rows. `<For each={rows} as="ul"
class="divide-y">` makes the rows direct children of a real `<ul>`, so the
  separators fall between them. The host is built through `jsx`, so `class`
  (string / array / toggle-map, static or reactive), `style`, and `ref` behave
  exactly as they do on any JSX element. Omitting `as` keeps the existing
  layout-neutral host — fully backward-compatible.

## 0.2.0

### Minor Changes

- d82bae9: Close a batch of capability gaps found migrating a real admin dashboard onto
  `@amritk/api` and `@amritk/mini`, all backward-compatible.

  **`@amritk/api`**

  - **All-optional query (and cookie) slots are optional at the call site.** When
    every property of a declared `query`/`cookies` schema is optional (no
    `required`), the slot — and, when it is the only declared slot, the whole
    input argument — is now optional in `ClientInput`, folded into `RequiredKeys`
    the same way a fully-absent slot already is. A GET whose query params are all
    optional type-checks as `client.listThings()`. `params` (the path needs them)
    and `body` (declaring it makes a body required) stay strictly required.
  - **Raw `text` / `bytes` request bodies.** `bodyType` gains `'text'` and
    `'bytes'`: the body is validated verbatim against the schema and handed to the
    handler as a `string` (decoded) or a `Uint8Array`, and the typed client sends
    the call's `body` on the wire unchanged under a raw content type you can
    override per call via `headers` — a `text/csv` or binary upload that stays
    inside the typed contract and client. Both engines and the OpenAPI document
    understand it; the 415 check is lenient (`text/*` for text, any media type for
    bytes) so the schema is the gate.
  - **`mounts` handlers receive `env` and `executionContext`.** Prefix-mounted
    sub-handlers (`toFetchHandler` and the compiled engine) are now called with
    the platform arguments as well as the `Request`, so an env-dependent
    sub-router — Better Auth on Cloudflare Workers, where secrets and the DB URL
    live on `env` — can build its instance inside the mount. Existing
    `(request) => Response` mounts keep working.

  **`@amritk/mini`**

  - **`bindSelect(node, model)`** — two-way binding between a `<select>` and a
    string signal, the dropdown analogue of `bindValue`/`bindChecked`: it sets
    `.value` (the property, so the option actually selects) and writes back on
    `change`.
  - **More typed form-control attributes.** `<input>` gains `name`, `checked`,
    `accept`, `min`, `max`, `step`, `multiple`, and `readonly`; `<textarea>` gains
    `name`, `required`, and `readonly` — so file, number, and checkbox inputs stop
    needing `ref` + `setAttribute`.

- 5f0329e: Round out `@amritk/mini` after a deep review, closing gaps without changing the charter:

  - **`mount(container, component)`** — the application root that was missing: it runs a component inside an owning `effectScope`, appends the node, and returns a `dispose` that removes the node and tears the scope down. Top-level `onCleanup` and bindings now have an owner (previously they leaked because a raw `appendChild(App())` opened no scope).
  - **`<For>` is O(n) again** — the core `list` now hands `key`/`create` the running index, so `For` no longer recovers it with an O(n) `each().indexOf(item)` per item (which also mis-keyed duplicate primitives).
  - **SVG works** — the JSX runtime creates SVG tags with `createElementNS`, so `<svg>`/`<path>`/… render instead of becoming inert HTML-namespaced elements. Common SVG element and attribute types are included.
  - **`class` and `style` objects** — `class` accepts a string, an array (falsy entries dropped), or a `{ name: boolean }` toggle map; `style` accepts a cssText string or a property object (camelCase keys kebab-cased). Both stay static-or-reactive. `<select>`/`<option>`/`<form>` attributes are now typed.
  - **`/query` reactive options** — `createQuery` accepts an options getter, so the query key can depend on signals (`() => ({ queryKey: ['user', id()] })`) and refetches when they change. `refetch()` now returns its promise.
  - **Non-string form fields** — `createForm` field values may be `string | number | boolean`; `bind` wires `.checked` for checkbox/radio and a coerced number for number/range inputs, and cleans up its value binding and blur listener with the enclosing scope. New core `bindChecked`. `bindValue` now holds writes during IME composition and commits on `compositionend`.
  - **Router** — `RouteState` gains a parsed `query` record, and a new `<RouterView>` renders the matched route's view and swaps it on navigation (removing the manual cast).
  - **`watch`** — accepts `{ immediate: true }` to also run once on setup.

## 0.1.0

### Minor Changes

- 508aafe: Add `@amritk/mini` — a deliberately tiny signals-based UI layer built on `alien-signals`. Provides fine-grained reactivity (`signal`, `computed`, `effect`, `effectScope`, `batch`, `watch`, `onCleanup`), a capped set of DOM bindings that keep data off the `innerHTML` XSS surface (`bindText`, `bindAttr`, `bindClass`, `bindShow`, `bindValue`, and the single sanctioned `bindHtml` sink), keyed reactive collections (`list`) and static-template cloning (`template`), and a compilerless JSX runtime (`@amritk/mini/jsx-runtime`) whose reactivity is decided by value shape at runtime — a function-valued attribute or child is a live binding, everything else is applied once.
- 79b2383: Grow `@amritk/mini` into a layered framework via tree-shakeable subpath exports, with the `.` entry unchanged (its only runtime dependency stays `alien-signals`) and `"sideEffects": false` set so the bundle-size-sensitive widget pays zero bytes for any of them.

  - **`@amritk/mini/router`** — a client-side router in history or hash modes: `createRouter` (reactive `route` signal + `navigate` + `stop`), `matchRoute` (`/users/:id` patterns with a trailing `*` catch-all), and a `<Link>` that intercepts plain clicks while leaving modified clicks to the browser. Composition is explicit — `<Link>` takes `router.navigate` as a prop, not from a context.
  - **`@amritk/mini/flow`** — ergonomic control-flow components built on core primitives: `<Show>`, `<For>` (keyed, backed by `list`), `<Switch>`/`<Match>`, and `<Dynamic>`.
  - **`@amritk/mini/forms`** — field state (value/dirty/touched/errors as signals), submit handling, and validation that accepts either a `(values) => errors` function or a JSON Schema validated through `@amritk/runtime-validators` (eval-free/CSP-safe); inputs bind through the core `bindValue`.
  - **`@amritk/mini/query`** — a thin adapter bridging `@tanstack/query-core` observers to mini signals (caching/dedup/retry/invalidation from TanStack Query), mirroring how `solid-query` wraps query-core.

  `@amritk/runtime-validators` and `@tanstack/query-core` are optional peer dependencies, needed only by `/forms` schema validation and `/query` respectively. Two enforcement tests ship with the work: a core import-boundary walk (the `.` graph contains only `alien-signals` and no subpath leaks, and each feature stays free of the others) and a gzipped size budget on the bundled `.` entry.
