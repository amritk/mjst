/**
 * `@amritk/mini/vite` — mini's two build-time plugins. Both exist for the same
 * reason: some things about a compilerless runtime can only be settled by
 * reading the source, because neither the type checker nor the runtime can see
 * them.
 *
 * {@link catchCalledSignals} guards the one JSX footgun. `attr={signal()}` calls
 * the getter and freezes a plain value at creation, where `attr={signal}` binds
 * it reactively. Added to your Vite config it reports live in the dev server (a
 * warning per finding) and fails `vite build`, so one plugin covers both the
 * editor feedback loop and the CI gate. `findCalledSignalBindings` is exported
 * too, for a bespoke lint command or editor integration.
 *
 * {@link acceptHotUpdates} turns the module that calls `hotMount` (from
 * `@amritk/mini/hot`) into the app's hot-update boundary, by appending the
 * `import.meta.hot?.accept()` that Vite's import analysis scans the source for.
 * Without it that scan finds nothing to accept the update and the dev server
 * falls back to a full page reload.
 *
 * `vite` and `typescript` are optional peer dependencies, needed only by this
 * subpath — the `.` core stays dependency-free.
 */
export { acceptHotUpdates } from './accept-hot-updates'
export type { CalledSignalBinding } from './find-called-signal-bindings'
export { findCalledSignalBindings } from './find-called-signal-bindings'
export type { CatchCalledSignalsOptions } from './plugin'
export { catchCalledSignals } from './plugin'
