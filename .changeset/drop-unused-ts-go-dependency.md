---
---

Refresh every dependency to the newest version that clears the five-day
`minimumReleaseAge` gate, and drop the unused `ts-go` devDependency.

`ts-go` was never referenced: every package's `build` and `types:check` script
calls `tsgo`, which comes from `@typescript/native-preview`. `ts-go` is an
unrelated package ("Typescript Module Template") whose bin is `ts-go`, and it
pulled a legacy `yargs@11` tree — 59 of the lockfile's 669 entries, and the only
path to the `yargs-parser` prototype-pollution advisory. The CLI's own `yargs@17`
resolves `yargs-parser@21`, which is unaffected.

Six `overrides` pin transitive packages that `bun update` cannot reach on its
own. Each target sits inside the range its parent already declares, so no parent
is being pushed past its own compatibility contract.

Together this takes `bun audit` from 31 advisories to 6. The six that remain are
all `js-yaml`, which has no fix available: the `!!omap` advisory covers 3.x and
4.x alike, and the copy under `@changesets/cli` arrives through `read-yaml-file`,
whose `^3.6.0` range can never reach the fixed 5.x line.

Tooling only: every version touched here is a devDependency or an override, so
no published package's shipped output or dependency ranges change.
