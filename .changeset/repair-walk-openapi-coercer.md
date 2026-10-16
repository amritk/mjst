---
'@amritk/validation': minor
---

`repairX` can now serve as a fast, in-place coercer for large documents such as bundled OpenAPI descriptions.

- **Options.** `repairX(input, options?)` takes `{ path, inPlace, coerce, refs, skipRefs, onRef, maxDepth, maxWork, memo, finite, plainObjects }`. A bare string is still read as the base path. `inPlace: true` assigns and deletes on the input instead of copying; `coerce: false` skips the Ajv-style scalar coercion and repairs only reported positions.
- **Single-pass walk.** When every definition uses `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `items`, `$ref`, `if`/`then`/`else` and `allOf` (plus annotations and scalar assertions), the generated `repairX` checks and repairs each position in one walk instead of the validate-and-repair loop. Errors go into one shared array, and paths are built only when something is reported. A valid document comes back as itself, with nothing copied. A 24 MB OpenAPI document takes well under 100 ms. Other schemas keep the loop, which throws on the walk-only options (`skipRefs`, `onRef`, `maxDepth`, `maxWork`, `memo`, `finite`, `plainObjects`) instead of ignoring them.
- **Conditionals.** `repairXAt` and the walk descend through `if`/`then`/`else` and `allOf`, and evaluate each `if` against the instance value at that point.
- **One-step fills.** A missing required object is built with its required children filled recursively. The depth is bounded on recursive definitions.
- **Removal.** `"x-repair": "drop"` and `false` schemas remove a failing position (a property, a key `additionalProperties: false` forbids, an array element) instead of writing a default.
- **Instance `$ref`s.** `"x-repair": "ref"` on a Reference schema opts in. Each target is resolved against the root document and repaired under the referencing position's type. Targets are walked once per type, chains and cycles included. A target that does not resolve is reported as `unresolvedRef` and never created.
- **Guards.** `maxDepth` and `maxWork` caps, an opt-in `memo` for shared or cyclic in-memory graphs, `finite` numbers, and `plainObjects` (no own `__proto__`).
- **Large error lists.** `validateX` no longer spreads a `$ref`'s errors into `push`, which threw a `RangeError` once a document had enough of them.

Breaking: the generated `RepairLookup` type is now `(segments, index, value) => RepairThunk | typeof REPAIR_DROP | null`, and thunks take `(depth, into?)`. Code that called a `repairXAt` lookup directly must pass the start index and the instance value. With repair on, a definition named `CoercionResult`, `RepairResult`, `RepairLookup`, `RepairOptions`, `RepairThunk`, `RepairWalk` or `RepairRun` is refused, since every repairing file imports those names. Generated files import `runRepairLoop` / `runRepairWalk` instead of `applyRepairs` and `MAX_REPAIR_PASSES`; both are still exported from `validation-result.ts`.
