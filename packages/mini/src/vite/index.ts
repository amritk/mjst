/**
 * `@amritk/mini/vite` — a build-time guard for mini's one compilerless-JSX
 * footgun. `attr={signal()}` calls the getter and freezes a plain value at
 * creation, where `attr={signal}` binds it reactively; the mistake cannot be
 * caught at runtime or by the type checker, so it is caught in the source here.
 *
 * Add {@link catchCalledSignals} to your Vite config and it reports live in the
 * dev server (a warning per finding) and fails `vite build` — so one plugin
 * covers both the editor feedback loop and the CI gate. `findCalledSignalBindings`
 * is exported too, for a bespoke lint command or editor integration. `vite` and
 * `typescript` are optional peer dependencies, needed only by this subpath — the
 * `.` core stays dependency-free.
 */
export type { CalledSignalBinding } from './find-called-signal-bindings'
export { findCalledSignalBindings } from './find-called-signal-bindings'
export type { CatchCalledSignalsOptions } from './plugin'
export { catchCalledSignals } from './plugin'
