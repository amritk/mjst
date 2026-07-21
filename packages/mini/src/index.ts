/**
 * @amritk/mini — a deliberately tiny UI layer for the embeddable widget:
 * alien-signals for reactivity plus a capped set of DOM helpers and a
 * compilerless JSX runtime.
 *
 * The cap is the design. There is no diffing, no re-render, and no compiler —
 * JSX (or `template`) builds real DOM once, dynamic values flow through the
 * bind helpers or function-valued props, and repetition goes through `list`.
 * If a feature seems to be missing here, the correct next step is usually a
 * real framework (Preact or Solid), not a new helper.
 */

export { bindAttr, bindChecked, bindClass, bindHtml, bindSelect, bindShow, bindText, bindValue } from './bind'
export type { Component, MaybeReactive, MiniChild, MiniChildren, TargetedEvent } from './jsx-runtime'
export { list } from './list'
export { mount } from './mount'
export { onCleanup } from './on-cleanup'
export { batch, computed, effect, effectScope, type ReadonlySignal, type Signal, signal } from './signals'
export { type TemplateInstance, template } from './template'
export { type WatchOptions, watch } from './watch'
