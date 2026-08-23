---
'@amritk/lint': minor
---

Report each finding at the node the author actually wrote, and stop reporting the
same one twice.

Three changes, all about a finding's `path` and where it points.

**A finding's `path` is now the path in the document it is reported against.** A
rule that runs against the dereferenced tree matches a position that need not
exist in the source: `paths./pets.get.parameters.0.name` where the author wrote
`$ref: '#/components/parameters/Id'`. The `range` and `source` already pointed at
the declaration, so `path` disagreed with them — it named a node in a third tree,
one that no editor could jump to and that a fixer resolving it against the raw
document would not find. `path` now names the same node the range does. Nothing
changes for an unresolved rule, or for a finding on a node with no `$ref` above
it.

**A `$ref` with siblings is read where it was written.** `{ $ref: '#/…/Usage',
nullable: true }` is how an OpenAPI document overrides a shared schema: the
`nullable` lives at the `$ref` site and exists nowhere in the target. The
translation back to the source followed the `$ref` regardless, producing
`components.schemas.Usage.nullable` — a node nobody wrote. The finding then took
the range of the whole `Usage` schema (the nearest ancestor that does exist), and
the migration fixer for it silently did nothing. Both are fixed: a segment the
`$ref` object owns itself stops the walk, so the finding lands on the override,
and `--fix-unsafe` rewrites it. On the OpenAPI corpus this turns two findings
pointing at two 30-line schemas into four pointing at the four `nullable: true`
lines that caused them.

**Identical findings are collapsed.** With a resolver, a mistake in a
`components` entry is reported once per `$ref` reaching it — same rule, same
severity, same message, same `line:column`, now also the same `path`. Copies
after the first told a reader nothing, so only the first survives. Findings about
*absent* fields keep their own paths and so all survive: `info.contact` missing
`name`, `url` and `email` share the enclosing object's range but remain three
problems.

Also: `--fix` no longer feeds a fixer findings from a file inlined by the
resolver. Those paths are relative to the other document, so applying them here
edited whatever happened to sit at the same path.
