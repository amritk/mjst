---
'@amritk/generate-examples': patch
---

Make generation linear in the `$ref` graph, and stop shipping examples that fail their own schema

**A `$ref` reachable by several paths is derived once, not once per path.**
`deriveExample` tracked visited refs in a *path-scoped* set with no memo table,
so every fan-out in the definition graph re-expanded the same subtree
exponentially: a 25-definition graph with three refs per definition took ~20
seconds, and adding two more definitions roughly quadrupled that. Derivation is
now memoized per ref per root document — the pattern
`@amritk/helpers/walk-ref-graph` already uses for `resolveRef` — with the cycle
guard kept exact: a value produced by cutting a cycle is deliberately not
memoized, so a recursive definition still terminates at the same place. The same
graph at 400 definitions now derives in ~7 ms.

**A validating check no longer carries the whole document.** Every check spliced
the root's entire `$defs` into the schema it validated, and the interpreter
screens each `pattern` in whatever it is handed — so a 959-definition OpenAPI
document paid for all 959 definitions on each of the thousand-odd checks a
generation run makes, and embedded the whole document into every generated file
carrying a validating filter. Only the definitions a schema's `$ref`s actually
reach travel with it now (a reference that cannot be pinned to one definition —
an `$anchor` name, or a `$dynamicRef`/`$recursiveRef`, whose target is picked
from the dynamic scope at validation time — still falls back to the full set).
Generating the OpenAI corpus went
from ~3.6 s to ~0.3 s, and its generated output from 119 MB to 2.7 MB.

**Generated arbitraries compile under a strict tsconfig.** `fc.constantFrom("a",
"b")` infers `Arbitrary<string>`, which does not fit the `"a" | "b"` the
generated type declares — so *any* schema with an `enum` property produced a
file no consumer on `strict` could build. Scalar members are now spread from a
`const`-asserted tuple, and a filtered arbitrary's predicate is written as a
type guard (`(value): value is Foo => …`), which is what it has always been: the
combinators generate a superset and the runtime validator narrows it. A new
suite type-checks generated files against the real `fast-check` declarations
under `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.

**An example that fails its own schema is now reported instead of shipped
quietly.** Every `fooExample` is validated (formats included) before it is
written; a value that does not satisfy the schema is still emitted, so the
module compiles, but the generator warns and names the type. Several cases that
used to fail silently now produce valid values: `not` gets a perturbation
candidate (`not: { const: 'string' }` no longer returns `"string"`),
`uniqueItems` over a closed value set walks the set instead of suffixing a
string out of its own `enum`, `pattern` sampling honours `minLength` and reads
control escapes (`a\nb` produced `"anb"`), and static examples now cover every
`format` `@amritk/runtime-validators` checks — `duration`, `json-pointer`,
`relative-json-pointer`, `uri-template`, `uri-reference`, `regex`, and the `idn-`
/`iri` variants. A key that `additionalProperties: false` forbids is no longer
invented. The remaining limits are written down in the README.

**A `__proto__` property survives.** Both the derived value (`out[key] = …` hit
`Object.prototype`'s prototype setter, so the key vanished) and the emitted
source (a *quoted* `"__proto__":` in an object literal is still the setter, in
the example value and in the `fc.record` config — where it also reassigned the
config object's prototype to an `Arbitrary`). The value uses `defineProperty`
and the source uses the computed `["__proto__"]:` form, matching what
`generate-parsers` already does.

**A schema the validator refuses no longer kills the run — and no longer goes
unmentioned.** A `$ref` pointing outside the document (`#/components/schemas/…`
in a bare fragment) threw out of `buildExampleSchema`. Those checks are opinions
about a candidate value, so an undecidable schema now abstains. It also warns
once, naming the schema and the reason, because a filter that switches itself
off silently is indistinguishable from one that ran and approved of everything.
