import { type Component, jsx, type MiniElementProps } from '../jsx-runtime'
import { createHost } from './create-host'
import { renderChild } from './render-child'

/** A thing `<Dynamic>` can render: an intrinsic tag name or a component function. */
export type DynamicComponent = string | Component<never>

/**
 * Props for {@link Dynamic}: the component to render plus every other prop,
 * forwarded verbatim to it. The index signature is `unknown` because the props
 * a dynamic component needs are only known to the caller.
 */
export type DynamicProps = {
  /**
   * What to render — either an intrinsic tag string, or a getter (a signal
   * counts) that returns the tag or component. The getter is required for the
   * function case, and is what makes it reactive: a bare component function
   * cannot be told apart from a reactive getter (both are just functions), so
   * pass `component={() => MyComponent}` rather than `component={MyComponent}`.
   */
  component: string | (() => DynamicComponent)
  [prop: string]: unknown
}

/**
 * Renders a component chosen at runtime, re-rendering when the choice changes.
 * `<Dynamic component={tag} .../>` resolves `tag` (reading any signals it
 * touches) and hands the result to `jsx`, so a single call site can render
 * different elements over time — a tag name driven by state, or one of several
 * components selected by a getter.
 *
 * Every prop other than `component` (children included) is passed straight
 * through to the rendered element.
 */
export const Dynamic = (props: DynamicProps): HTMLElement => {
  const host = createHost()
  const { component, ...rest } = props
  renderChild(host, () => {
    // Resolving inside the tracking scope is what makes a signal/getter
    // reactive; a plain string simply renders once.
    const resolved = typeof component === 'string' ? component : component()
    return () => jsx(resolved, rest as MiniElementProps)
  })
  return host
}
