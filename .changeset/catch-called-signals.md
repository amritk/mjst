---
---

Add `scripts/catch-called-signals.ts`, a source scanner that catches mini's
compilerless-JSX footgun: `attr={signal()}` calls the getter and freezes a
plain value at creation, where `attr={signal}` binds it reactively. The mistake
cannot be caught at runtime (props are evaluated before `jsx()` runs) or by the
type checker (a called signal returns a valid static value), so it has to be
caught in the source. The scanner walks the TypeScript AST (an existing
dev dependency) and flags the unambiguous shape — an attribute whose whole value
is a single zero-argument call — leaving bare getters, thunks, and handlers
alone, and honours a `catch-called-signals-ignore` comment for deliberate cases.
Because the parser does the work, comments and strings never trip it and
multi-line attributes are found. Exposed as `bun run lint:called-signals`.
