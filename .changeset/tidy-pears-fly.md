---
'@amritk/resolve-refs': patch
---

Rebase only `$ref`, and never write into an aliased document.

A kept `$dynamicRef` or `$recursiveRef` was rebased like a `$ref`, but those
carry an *anchor name* rather than a location — `#meta` is the whole legal
spelling — so qualifying one with a document produced a value no consumer can
resolve; `@amritk/helpers` throws on it outright, turning a soft kept reference
into a hard build failure.

The depth-limit rebase also stops at any object whose prototype is neither
`Object.prototype` nor `null`. `detach` hands such an object back by reference
(there is no general clone for a class instance), and it may live in the
process-wide remote-document cache — so writing a rebased `$ref` into it
rewrote the cached document for every later resolve in the process, which would
then rebase it again against a different root.
