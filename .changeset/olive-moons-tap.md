---
'@amritk/resolve-refs': minor
---

Fix six bugs found by an audit of the resolver, two of them security-relevant.

- **JSON Pointer lookup walked the prototype chain.** `{"$ref": "#/constructor"}`
  resolved to `Object`'s constructor and inlined a JS function into the
  dereferenced document; on a process where anything had polluted
  `Object.prototype`, an arbitrary `#/<name>` resolved to the injected value
  instead of being reported as unresolvable. Only own properties are addressable
  now.
- **The remote-document cache scope ignored the host guards.** `assertPublicHost`
  runs at fetch time only, so a call made with `allowPrivateHosts` (or an
  `allowedHosts` entry) warmed the session cache for a URL that a
  default-options call would have refused — and the later call, hitting the
  cache, never reached the guard. `allowPrivateHosts` and `allowedHosts` are now
  part of the cache key, alongside the credentials and limits already there.
- **Cross-file cycle hoisting could overwrite a root `$defs` entry.** The hoisted
  name is derived from the ref's file basename, so `b.json` collided with a root
  definition already called `b` and silently re-pointed every kept `#/$defs/b`
  cycle ref at the wrong schema.
- **A fragment that resolved to nothing inside a document that loaded fine
  inlined as `undefined` with nothing on `errors`** — the key vanished on
  serialization, so a required property silently lost every constraint it had.
  It is now reported and the node kept, matching `resolveRefs`. A ref into a
  document that failed to load is unchanged (the loader already reports that).
- **Results aliased the session cache.** Value-position subtrees (`enum`,
  `const`, `default`, `examples`) and subtrees past `maxDepth` were handed back
  by reference from the process-wide remote cache, so a caller mutating its own
  result corrupted every later resolve in the process.
- **`pathToRef` did not percent-encode.** A `$defs` key containing `%` produced a
  kept cycle `$ref` that read back as a different key, so it resolved to nothing
  in the output document.
