import { toGetter } from '../internal/to-getter'
import { jsx, type MaybeReactive, type MiniChildren, type MiniElementProps, type StyleValue } from '../jsx-runtime'
import type { NavigateOptions } from './create-router'

/** Props for {@link Link}. */
export type LinkProps = {
  /** The destination path (relative to the router's `base`). Static or reactive. */
  to: MaybeReactive<string>
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
  /**
   * Whether this link points at the current location. Drives {@link LinkProps.activeClass}
   * and `aria-current="page"`. Matching is the caller's call — mini has no
   * ambient router — so derive it from the route signal, e.g.
   * `active={() => router.route().path === '/'}`.
   */
  active?: MaybeReactive<boolean>
  /** Class appended while {@link LinkProps.active} is true (on top of `class`). */
  activeClass?: string
  /** Anchor `target`, e.g. `_blank`. */
  target?: MaybeReactive<string>
  /** Anchor `rel`, e.g. `noopener noreferrer`. */
  rel?: MaybeReactive<string>
  /** Anchor `title`. */
  title?: MaybeReactive<string>
  /** Element `id`. */
  id?: MaybeReactive<string>
  /** Inline style, the same forms JSX's `style` accepts. */
  style?: MaybeReactive<StyleValue>
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
 *
 * Pass `active` (plus `activeClass`) to mark the current link — it toggles the
 * class and sets `aria-current="page"`, the one router-link feature every nav
 * bar needs.
 */
export const Link = (props: LinkProps): HTMLElement => {
  const to = toGetter(props.to)
  const active = props.active === undefined ? undefined : toGetter(props.active)

  const anchorProps: Record<string, unknown> = {
    href: to,
    onClick: (event: MouseEvent): void => {
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
      props.navigate(to(), { replace: props.replace ?? false })
    },
    children: props.children,
  }

  // Merge `activeClass` into `class` reactively when `active` can toggle;
  // otherwise forward `class` untouched so a fully-static link stays effect-free.
  if (active !== undefined && props.activeClass !== undefined) {
    const base = props.class === undefined ? undefined : toGetter(props.class)
    anchorProps['class'] = () => [base?.(), active() ? props.activeClass : undefined].filter(Boolean).join(' ')
    anchorProps['aria-current'] = () => (active() ? 'page' : null)
  } else if (props.class !== undefined) {
    anchorProps['class'] = props.class
  }

  for (const key of ['target', 'rel', 'title', 'id', 'style'] as const) {
    if (props[key] !== undefined) anchorProps[key] = props[key]
  }

  return jsx('a', anchorProps as MiniElementProps)
}
