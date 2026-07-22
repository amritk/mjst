---
"@amritk/mini": minor
---

Add `@amritk/mini/vite`, a build-time guard for mini's one compilerless-JSX
footgun: `attr={signal()}` calls the getter and freezes a plain value at
creation, where `attr={signal}` binds it reactively. The mistake cannot be
caught at runtime (props are evaluated before `jsx()` runs) or by the type
checker (a called signal returns a valid static value), so it is caught in the
source. `catchCalledSignals()` walks the TypeScript AST in Vite's `transform`
hook, so it reports live in the dev server — a terminal warning per finding
(clickable `file:line:column`) plus a non-blocking error overlay — and fails
`vite build`, one plugin covering both the editor feedback loop and the CI gate.
Pass `{ overlay: false }` to keep dev feedback in the terminal only. It flags only the unambiguous shape
(a binding whose whole value is a single zero-argument call) — both attributes
(`disabled={streaming()}`, `show`/`class`/`style`, and component props such as
`<For each={items()}>`) and children (`<span>{count()}</span>`) — leaving bare
getters, thunks, and handlers alone, and honours a `catch-called-signals-ignore`
comment for deliberate cases. The exported `findCalledSignalBindings` core backs
a bespoke lint command or editor integration. `vite` and `typescript` are
optional peer dependencies of this subpath only — the `.` core stays
dependency-free.
