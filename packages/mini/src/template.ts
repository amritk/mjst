/** A cloned template instance: the root element plus every `data-ref` node inside it. */
export type TemplateInstance = {
  root: HTMLElement
  ref: Record<string, HTMLElement>
}

/**
 * Parses a static HTML string once and returns a clone factory. Each call
 * clones the parsed tree and collects every `data-ref="name"` node into
 * `ref.name`, which replaces both a template compiler and manual
 * `createElement` chains.
 *
 * Safety: the argument must be a static string literal with no interpolated
 * data — dynamic content flows through the bind helpers, which use
 * `textContent`. This keeps `template` off the XSS surface entirely.
 *
 * @example
 * ```ts
 * const row = template('<li><span data-ref="label"></span></li>')
 * const { root, ref } = row()
 * const count = signal(0)
 * bindText(ref.label, () => `${count()} items`) // dynamic data via bind, not interpolation
 * document.body.append(root)
 * ```
 */
export const template = (html: string): (() => TemplateInstance) => {
  const parsed = document.createElement('template')
  parsed.innerHTML = html
  return () => {
    const fragment = parsed.content.cloneNode(true) as DocumentFragment
    const root = fragment.firstElementChild as HTMLElement
    const ref: Record<string, HTMLElement> = {}
    for (const node of root.querySelectorAll<HTMLElement>('[data-ref]')) {
      ref[node.dataset['ref'] as string] = node
    }
    if (root.dataset['ref']) ref[root.dataset['ref']] = root
    return { root, ref }
  }
}
