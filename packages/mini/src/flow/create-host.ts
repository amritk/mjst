/**
 * Creates the layout-neutral host element a flow component swaps its children
 * inside. It carries `display: contents`, so the wrapper box disappears from
 * layout and its children participate in the parent's flow (grid/flex/inline)
 * as if the wrapper were not there — the control-flow component adds a node to
 * the tree but not to the visual box model.
 *
 * The one caveat is HTML content models that reject a `<div>` child (a direct
 * child of `<tr>`, `<tbody>`, `<select>`, …). Those are rare in the dashboards
 * these components target; when they come up, reach for `list` directly on the
 * real container instead.
 */
export const createHost = (): HTMLElement => {
  const host = document.createElement('div')
  host.style.display = 'contents'
  return host
}
