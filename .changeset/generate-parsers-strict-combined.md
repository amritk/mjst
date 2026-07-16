---
"@amritk/generate-parsers": patch
---

Fix strict mode silently coercing declared properties in the combined `properties` + `patternProperties` parser. That parser builds its result from the *coercing* property lines, so in strict mode a wrong-typed declared property was repaired and a missing required key was defaulted instead of throwing (e.g. `{ count: 'nope' }` → `{ count: 0 }`). It now asserts the declared properties (type, required, enum, constraints) via the shared strict assertion before building the result, so strict mode throws as documented. Unknown-key rejection (`additionalProperties: false`) and coerce mode are unchanged. (Note: `patternProperties` *values* are still not type-asserted in strict mode — a separate, narrower gap.)
