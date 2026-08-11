---
'@amritk/helpers': patch
---

Give the last three schema walkers the position rule, and pin the array case.

`renameNestedDefs` rewrote every `#/definitions/` ref and renamed every
`definitions` key at any depth — so a `default` value containing either came
back rewritten (a literal the author wrote, changed), and a *property*
genuinely called `definitions` was renamed to `$defs`, vanishing from the
emitted type with a property the schema never had in its place. Its sibling
`rewriteDefinitionsRefs` already honoured all three exemptions.

`expandBooleanDefinitions` and `rewriteRootRefs` classified the same way: a
`$defs` inside a `default` had its `true` expanded to `{}` (different generated
TypeScript, per the function's own docs), and a ref-shaped `default: { "$ref":
"#" }` had its literal rewritten to a pointer the author never wrote.

`schemaChildren` yields object children only, so each walker decided the array
case itself and they had split three-to-four on it. The rule — an element
inherits its array's position, as `resolve-refs`' `childRole` has it — is now
written down where the generator is defined, and all of them follow it.
`foldNullable` also reads `nullable`/`type` as own properties: a polluted
`Object.prototype.nullable` folded every node in the document, so every
generated parser accepted `null` where the schema forbids it.
