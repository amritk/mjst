---
'@amritk/lint': minor
---

`lintDocument`, `lintDocumentWithResult`, and `fixDocument` now accept a
`Ruleset` you have already built, not only a definition to build.

Without this there was no way to use a preset that brings its own functions and
format detectors through the package-root entry points. Handing them the `oas`
definition as plain data produced *nothing*: its custom functions are unknown
there, and — since every OpenAPI rule is format-gated — its `formats` gate
matched nothing against an empty format registry. The README and `oasFixers`
both told you to pass the fixers to `fixDocument`, which had no findings to work
from.

```ts
import { fixDocument } from '@amritk/lint'
import { createOpenApiRuleset, oasFixers } from '@amritk/lint/rules/openapi'

const { output, applied } = await fixDocument(source, {
  ruleset: createOpenApiRuleset(),
  fixers: oasFixers,
})
```

Passing a definition behaves exactly as before. `rulesetBasePath` and
`restrictTo` only apply while building, so they are ignored for a ruleset that
already is one.
