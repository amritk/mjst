import type { MaybeReactive, MiniChildren } from '../jsx-runtime'
import type { NavigateOptions } from './create-router'

/** Props for {@link Link}. */
export type LinkProps = {
  /** The destination path (relative to the router's `base`). */
  to: string
  /**
   * The router's `navigate`. Passed explicitly rather than pulled from a
   * context — mini prop-drills dependencies by charter — so `<Link>` stays a
   * plain component with no ambient state: `navigate={router.navigate}`.
   */
  navigate: (to: string, options?: NavigateOptions) => void
  /** Replace the current history entry instead of pushing one. */
  replace?: boolean
  /** Passed through to the underlying `<a>`, static or reactive. */
  class?: MaybeReactive<string>
  children?: MiniChildren
}

/**
 * An anchor that navigates through the router instead of triggering a full page
 * load. It renders a real `<a href>` — so it is a normal link to the browser
 * (open-in-new-tab, middle-click, copy-link, crawlers all work) — and only
 * intercepts the plain left-click that would otherwise reload the app.
 *
 * Modified clicks (Cmd/Ctrl/Shift/Alt), non-primary buttons, and any handler
 * that has already called `preventDefault` are left alone, so the browser's own
 * behaviour (new tab, download) is preserved.
 */
export const Link = (props: LinkProps): HTMLElement => {
  // Forward `class` only when supplied: with `exactOptionalPropertyTypes`, an
  // explicit `undefined` is not assignable to the optional `class` prop, so we
  // omit the key entirely rather than pass through a possibly-undefined value.
  const classProp = props.class === undefined ? {} : { class: props.class }
  return (
    <a
      href={props.to}
      {...classProp}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        props.navigate(props.to, { replace: props.replace ?? false })
      }}
    >
      {props.children}
    </a>
  )
}
