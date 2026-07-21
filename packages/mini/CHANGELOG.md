# @amritk/mini

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
