/**
 * `@amritk/mini/flow` — the ergonomic control-flow components mini's core
 * deliberately omits. Each one reuses a core primitive (`bindShow`, `list`, a
 * scoped `effect`) and adds nothing to the `.` entry: an app that imports only
 * `/flow` pulls in this module graph, and the widget that never imports it pays
 * zero bytes.
 *
 * The building block behind `Show`, `Switch`, and `Dynamic` is a reactive
 * single-slot swap that tears down the branch it replaces; `For` is `list`
 * with a default key. Structural changes here still mean real add/remove of
 * DOM — there is no diffing, only mount and dispose.
 */

export type { DynamicComponent, DynamicProps } from './dynamic'
export { Dynamic } from './dynamic'
export type { ForProps } from './for'
export { For } from './for'
export type { MatchProps } from './match'
export { Match } from './match'
export type { ChildFactory } from './render-child'
export type { ShowProps } from './show'
export { Show } from './show'
export type { SwitchProps } from './switch'
export { Switch } from './switch'
