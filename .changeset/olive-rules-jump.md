---
'@amritk/generate-parsers': patch
---

Import a tuple-position `$ref` as a type. Adding `prefixItems` to the import
walk fixed the missing import (TS2304) but emitted the full value import, and
the parser emitter passes a tuple element through untouched — so `parseContact`
and `validateContactShape` arrived unused, which `noUnusedLocals` makes a
compile error in the consumer's build. A ref reached only from tuple positions
now emits `import type`; one reached from anywhere else keeps the value import,
and a ref in both wins the value import.
