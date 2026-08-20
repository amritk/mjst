---
'@amritk/resolve-refs': patch
---

Fix a `TypeError` escaping `resolveRefsFromFile`, speed up `$id` scope lookup, and
widen the non-public address check.

- A `$ref` whose location does not parse (`//[bad`) inside a document reached
  remotely threw `TypeError [ERR_INVALID_URL]` straight out of the resolver,
  breaking the package's contract that a bad ref is collected on `errors` and
  never thrown. It is now reported and the reference kept, like any other
  unresolvable one.
- Looking up the base URI a node's `$id` establishes scanned every registered
  resource, which is quadratic in the number of `$id`s — the shape bundled
  schemas have. It is an identity lookup now: a document with 8,000 `$id`s
  resolves in ~42ms instead of ~772ms.
- `isPrivateHost` now also refuses IPv4 multicast (`224.0.0.0/4`) and reserved
  (`240.0.0.0/4`, which is where `255.255.255.255` lives). Neither is a public
  unicast destination.
