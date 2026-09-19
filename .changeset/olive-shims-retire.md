---
'@amritk/parsers': minor
---

Retire `@amritk/generate-parsers` and `@amritk/generate-validators`, and drop the
two internal subpath exports that existed only for them.

Both engines moved into `@amritk/parsers` in the previous change, leaving those
packages as forwarding shims. The shims are gone: both directories are now
private and hold nothing but their published `CHANGELOG.md`, a deprecation
notice pointing at `@amritk/parsers`, and the manifest needed to run
`npm deprecate` against the versions already on npm. Nothing new is published
from either.

**Breaking, for anyone who found them:** `@amritk/parsers/internal/parsers` and
`@amritk/parsers/internal/validators` are removed. They were never a supported
entry point — they existed so the shims could reach the engines through the
package boundary — and with the shims retired there is nothing left to reach
them. The engines stay internal, reached through `#parsers/*` and
`#validators/*` inside the package.

Nothing else changes: `generate`, `ALL_MODES`, `GeneratedFile`,
`GenerateOptions`, `Mode` and `ImportExtension` are the same, and the generated
output is byte-identical.

Migrating off the retired packages:

```ts
// before
import { buildSchema } from '@amritk/generate-parsers'
const files = await buildSchema(schema, 'Document')

// after
import { generate } from '@amritk/parsers'
const files = await generate(schema, 'Document', { modes: ['parse'] })
```

```ts
// before
import { buildValidatorSchema } from '@amritk/generate-validators'
const files = await buildValidatorSchema(schema, 'Document')

// after
import { generate } from '@amritk/parsers'
const files = await generate(schema, 'Document') // types + guard + validate
```
