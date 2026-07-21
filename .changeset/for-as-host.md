---
"@amritk/mini": minor
---

`<For>` now accepts an `as` prop (with `class`/`style`/`ref`) to render its
rows into a real element instead of the default `display: contents` host. This
closes the one place `For` couldn't slot in: a `divide-y`-style list, whose
`& > :not([hidden]) ~ :not([hidden])` separators only match the container's
*direct* children — the `display: contents` wrapper hid the rows one level too
deep, so the borders landed between hosts, not rows. `<For each={rows} as="ul"
class="divide-y">` makes the rows direct children of a real `<ul>`, so the
separators fall between them. The host is built through `jsx`, so `class`
(string / array / toggle-map, static or reactive), `style`, and `ref` behave
exactly as they do on any JSX element. Omitting `as` keeps the existing
layout-neutral host — fully backward-compatible.
