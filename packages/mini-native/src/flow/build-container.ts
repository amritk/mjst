import { applyProp } from '../apply-prop'
import { requireHost } from '../current-host'
import type { ElementTag } from '../elements'
import type { ClassValue, HostElement, MaybeReactive, StyleValue } from '../types'

/** The container-shaping props the collection components share. */
export type ContainerProps = {
  /**
   * Render rows into a real element of this tag instead of the default flow
   * wrapper. Reach for it when the container itself needs to be styled or to
   * lay its rows out directly — a `scroll-view` of rows being the common case.
   */
  as?: ElementTag
  /** Class for the `as` container. Ignored when `as` is not set. */
  class?: MaybeReactive<ClassValue>
  /** Style for the `as` container. Ignored when `as` is not set. */
  style?: MaybeReactive<StyleValue | null>
  /** Called with the container once built — the escape hatch for wiring it directly. */
  ref?: (element: HostElement) => void
}

/**
 * Builds the element rows are reconciled into: the shared flow wrapper by
 * default, or a real element of the requested tag with `class`, `style`, and
 * `ref` applied exactly as they would be on any other element.
 *
 * Shared by `For` and `Index` because the container is the one thing the two
 * genuinely have in common — they differ only in how a row is identified, and
 * duplicating the container handling would let the two drift apart on which
 * props they honour.
 */
export const buildContainer = (props: ContainerProps): HostElement => {
  const host = requireHost()
  if (props.as === undefined) return host.createFlowHost()

  const container = host.createElement(props.as)
  if (props.class !== undefined) applyProp(container, 'class', props.class)
  if (props.style !== undefined) applyProp(container, 'style', props.style)
  props.ref?.(container)
  return container
}
