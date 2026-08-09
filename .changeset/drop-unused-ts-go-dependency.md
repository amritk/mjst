---
---

Remove the unused `ts-go` root devDependency and raise the `hono` devDependency
floor to `^4.12.34`.

`ts-go` was never referenced: every package's `build` and `types:check` script
calls `tsgo`, which comes from `@typescript/native-preview`. `ts-go` is an
unrelated package ("Typescript Module Template") whose bin is `ts-go`, and it
pulled a legacy `yargs@11` tree — 59 of the lockfile's 669 entries, and the only
path to the `yargs-parser` prototype-pollution advisory. The CLI's own `yargs@17`
resolves `yargs-parser@21`, which is unaffected.

Tooling only: no published package's shipped output changes.
