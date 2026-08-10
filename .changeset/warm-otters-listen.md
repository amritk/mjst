---
'@amritk/api': patch
---

Export `RefineIssue` and `RefineInput` from `@amritk/api/client`.

`refine` is a field of the browser-safe `Contract`, so a contracts file shared
between server and browser can declare one — and the bundler strip
(`stripContractFields`) exists precisely to drop its body from browser builds,
which only makes sense if such a contract is written against the `/client`
entry in the first place. But the two types that hook is made of were exported
only from the root barrel, so lifting it out of the contract literal into a
named function — the moment a cross-field constraint outgrows an inline arrow —
had no type to name from `/client`, and reaching for the root `@amritk/api`
brings back exactly the `node:*` externalization warnings the subpath exists to
avoid. Both types are pure data shapes over the request slots, already reachable
from the subpath's import graph; nothing else about the entry changes.

`client.test.ts` now imports both as types and builds a standalone `refine` hook
with them, so dropping either export fails `types:check` rather than surfacing
in a consumer's editor.
