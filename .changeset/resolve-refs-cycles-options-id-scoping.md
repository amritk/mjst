---
"@amritk/resolve-refs": minor
---

Close four resolution gaps:

- **Cycles keep their recursive branch.** A reference cycle no longer collapses
  to an empty `{}` stub. The cycle point stays a `$ref` that resolves within
  the output document — a cross-file cycle target is hoisted into the root's
  `$defs` — so recursive schemas survive dereferencing intact.
- **`$id` base-URI scoping.** A ref whose URI (resolved against the enclosing
  base) matches an embedded resource's `$id` now resolves to it without
  fetching, and `$anchor`/`$dynamicAnchor` names bind within the resource that
  declares them before any document-global fallback — so bundled schemas and
  duplicate anchor names resolve correctly. Plain `#/pointer` fragments stay
  document-root-relative, and document retrieval remains location-based; the
  exact subset is documented in the README.
- **OpenAPI Reference Objects.** A `$ref` whose only siblings are `summary` /
  `description` inlines the target with those annotations overriding, instead
  of an `allOf` wrapper that is invalid in Path Item / Response / Parameter
  positions.
- **Remote fetch options.** New `ResolveOptions`: `headers` (record or per-URL
  function; never sent across cross-origin redirects), `fetch` (custom
  implementation — the SSRF guard still checks every hop), `timeoutMs`,
  `maxRedirects`, `maxBytes`, and `cache: false` to bypass the session cache
  for one call.
