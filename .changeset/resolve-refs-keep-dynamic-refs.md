---
'@amritk/resolve-refs': minor
---

Keep a `$dynamicRef` the dynamic scope has to answer, instead of inlining one
wrong target

A `$dynamicRef` binds at *evaluation* time to the outermost `$dynamicAnchor` of
its name along the chain of resources actually being applied, so the same keyword
can resolve to different schemas depending on where evaluation entered from.
Inlining happens once, which means a resolver that inlines every `$dynamicRef` is
guessing — and a wrong guess changes what the document accepts, in both
directions.

So it no longer guesses. Where the binding is decidable it inlines as before:

- a **pointer fragment** (`#`, `#/$defs/items`) is a plain `$ref` per the spec —
  there is no anchor to late-bind to;
- an **anchor name declared at most once** in the document has only one schema the
  dynamic lookup could ever reach.

Where it is not decidable — an anchor name declared twice or more — the
`$dynamicRef` stays in the output, along with the scaffolding it needs to resolve
at validation time: the `$dynamicAnchor`s it may bind to and the `$id`s that
delimit the resources those anchors live in. Inlining anything whose copy would
drop a resource out of that chain is held back for the same reason. This is the
move the resolver already makes for a reference cycle — keep the reference rather
than collapse it to one wrong answer — now covering both cases under one rule.

Consumers see no new API and no new errors: a kept reference is not a failure, it
is a reference the resolver could not answer without changing the document's
meaning, resolvable against the output exactly as it was against the input.
`trackOrigins` records nothing for one, because nothing was copied in its place.

On the `$ref` corpus of the official JSON Schema Test Suite the package is now at
**170 / 170**.

Two limits stay, documented in the code: a multi-document `resolveRefsFromFile`
still inlines (preservation only helps when the scaffolding survives into the
output, which a single-document resolve guarantees and a flattened multi-document
one does not), and 2019-09's `$recursiveRef` has the same defect but no corpus to
move it against.
