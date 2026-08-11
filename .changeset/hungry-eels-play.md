---
'@amritk/lint': patch
---

Register path parameter names as own keys, guard the last prototype-chain
lookup, and stop the tags fixer emitting an order the rule rejects.

`oasPathParam` recorded names with `defined[name] = path`, which on `__proto__`
runs the prototype setter and never creates a key. The name therefore never
registered: the duplicate check could not fire for it, the "must be used in
path" sweep skipped it, and — once the read side started asking `Object.hasOwn`
— the "must be defined" check reported a parameter that was defined right
there. The write is guarded now, so all three checks see it.

`resolveAlias` still indexed the alias table with a ruleset-supplied name, the
last of the four lookups of this kind in that file, and it was the one that
crashed rather than degrading: `given: ['#constructor']` resolved to `Object`,
whose missing `.targets` threw out of the whole lint run.

`compareAlphabetically` decides numeric-vs-textual per pair and so is
deliberately not a total order — that is what lets both `["2", "10"]` and
`["0x10", "9"]` read as ordered, two requirements no single total order can
satisfy. `Array.prototype.sort` on it can therefore return a sequence the rule
still rejects, which the tags fixer would emit every pass without ever clearing
the finding, until the loop ran out of passes and reported `converged: false`.
The fixer now checks its own result and leaves the array alone when no order
satisfies the rule.
