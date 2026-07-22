---
"@amritk/yaml": patch
---

Cap recursion depth when projecting a parsed document to JS (`toJS()` /
`parse()`), closing a stack-overflow DoS. The parser already bounds structural
nesting, but aliases are re-expanded during projection: an alias defined at
shallow depth can point at a deeply-nested node, and a chain of such aliases
made the expanded traversal far deeper than the parse tree while keeping the
node count under the existing alias-expansion budget. A small untrusted document
(tens of KB) could therefore drive projection into the native stack ceiling and
throw an uncatchable `RangeError`. Projection now enforces its own depth limit
(twice the parse cap, so ordinary alias reuse of a deep shared subtree still
works) and throws the same catchable resource-exhaustion error the budget does.
