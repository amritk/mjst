# Plan: shadcn/ui Compatibility for `@amritk/mini`

## Goal

Let mini apps use the [shadcn/ui](https://ui.shadcn.com) design system —
its look, its theming, its component API surface — without pretending mini
is React. The deliverable is a **mini-native component set that reuses
shadcn's design tokens, class strings, and variant contracts**, not a
runtime shim that runs shadcn's React source.

## The core constraint (why "compatible" needs a definition)

shadcn/ui is not a dependency you install and import. It is a CLI
(`npx shadcn add <name>`) that **copies React source files into your repo**.
Every file it emits is a real React module:

- `React.forwardRef`, `useState`, `usecontext`, `useId`
- for anything interactive — Dialog, Popover, Select, Dropdown, Tabs,
  Tooltip, Accordion, Combobox — the component is a thin wrapper over
  [Radix UI](https://www.radix-ui.com/) primitives, which are **React-only**
  (they use React context, portals, and hook-driven focus management).

mini is the deliberate opposite of React (`packages/mini/README.md`):

> There is no virtual DOM, no diffing, and no re-render. JSX builds real DOM
> **once**; dynamic values flow through the bind helpers or function-valued
> props; a component function runs a single time and returns the
> `HTMLElement` it built.

So there is no path where `npx shadcn add button` produces a file that runs
in mini. **"Compatibility" cannot mean drop-in use of shadcn's React
components.** It has to mean something achievable, and the good news is that
most of what makes shadcn *shadcn* is not React at all.

## Key insight: shadcn is ~80% not-React

Strip the React layer and what remains is portable as-is:

| shadcn layer | Nature | Portable to mini? |
|:---|:---|:---|
| Theme tokens (`--background`, `--foreground`, `--ring`, …, dark mode) | CSS custom properties | ✅ Copy verbatim |
| `cn()` — `clsx` + `tailwind-merge` | Pure JS | ✅ Works unchanged |
| `cva` variant → class maps | Pure JS | ✅ Works unchanged |
| Tailwind config / preset | Build config | ✅ Copy verbatim |
| Presentational components (Button, Badge, Card, Alert, Label, Input, Separator, Skeleton, Textarea, Avatar) | JSX + class strings + `cva` | ✅ Re-skin in mini JSX; identical classes, same variant API |
| Interactive primitives (Dialog, Popover, Select, Dropdown, Tabs, Tooltip, Accordion, Command) | Radix behavior — focus trap, portal, ARIA, roving tabindex | ⚠️ Behavior must be **reimplemented** on mini signals — real work, not a port |

The React parts we cannot reuse are exactly the *behavioral* parts:
focus trapping, portalling, `aria-*` wiring, roving tabindex, dismiss-on-
outside-click. Those are the value Radix adds — and the part we'd rebuild.

## What mini already gives us to build on

mini is a better starting point for this than it might look, because the
interactive primitives map cleanly onto existing modules:

- **State** — `signal` / `computed` / `effect` for open/closed, selected
  value, active tab. This is what React uses hooks for; mini uses signals.
- **Conditional rendering** — `@amritk/mini/flow` (`Show`, `Switch`,
  `Match`, `Dynamic`) already does single-slot reactive swap-with-teardown
  (`src/flow/match.tsx`), exactly what a Dialog body or Popover panel needs.
- **Two-way form binding** — `bindValue` / `bindChecked` / `bindSelect`
  and `@amritk/mini/forms` cover the input side of Select/Combobox/Switch.
- **Lifecycle** — `mount` owns an `effectScope`; `onCleanup` registers
  teardown. A portal/focus-trap can register its document listeners through
  `onCleanup` and be torn down deterministically when its branch disposes.
- **Attribute reactivity** — the JSX runtime already types
  `aria-*`/`data-*` as `MaybeReactive` (`src/jsx-runtime.ts`), so ARIA
  state (`aria-expanded`, `aria-selected`) is a getter, not manual DOM.

The gaps mini has **no** primitive for, which the interactive tier must add:

- **Portal** — mini renders in place; there is no "render to `document.body`"
  helper. Needed for Dialog/Popover/Tooltip overlays.
- **Focus trap** + focus restore on close.
- **Outside-click / Escape dismiss** as a reusable behavior.
- **Positioning** — anchoring a floating panel to a trigger (this is
  `@floating-ui/dom`'s job; it is framework-agnostic and would be the one
  new runtime dependency for the interactive tier).

## Proposed package layout

Follow mini's established subpath-export discipline
(`packages/mini/README.md` "Layered modules"): each tier is its own module
graph, importing one pulls in none of the others, and the bundle-size-
sensitive `.` entry stays untouched. This maps to three shippable layers:

```
@amritk/mini/ui           → cn(), cva re-export, token CSS, Tailwind preset  (Tier 1)
@amritk/mini/ui/*         → presentational components                        (Tier 2)
                            (Button, Badge, Card, Alert, Input, Label, …)
@amritk/mini/ui/overlay   → Portal, focusTrap, dismiss, anchor + the         (Tier 3)
                            interactive components built on them
```

Rationale for keeping it one package (`mini`) rather than a new package:
the components *are* mini idioms (they return `HTMLElement`, they take
`MaybeReactive` props), and the subpath-export + import-boundary test
(`src/import-boundary.test.ts`) already enforces the zero-cost-to-the-widget
guarantee. A separate `@amritk/mini-ui` package is the alternative if we want
independent versioning; it costs a second build/release lane for no
tree-shaking benefit over subpaths.

## Component authoring shape

A presentational component is nearly mechanical. shadcn's Button:

```tsx
// shadcn (React)
const buttonVariants = cva("inline-flex …", { variants: { … } })
const Button = React.forwardRef<HTMLButtonElement, Props>(
  ({ className, variant, size, ...props }, ref) =>
    <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />)
```

becomes, in mini — same `cva` table, same classes, no `forwardRef`
(mini components already *are* the element):

```tsx
// mini
export const buttonVariants = cva("inline-flex …", { variants: { … } })
export const Button: Component<ButtonProps> = ({ variant, size, class: cls, ...props }) =>
  <button class={() => cn(buttonVariants({ variant, size }), unwrap(cls))} {...props} />
```

Two deltas to design once and reuse everywhere:

1. **Reactive `class`** — shadcn class strings are static; mini's edge is
   that `variant`/`size`/`class` may be signals, so `class` is wrapped in a
   getter (the value-shape rule). A small `unwrap` helper handles the
   `MaybeReactive` prop.
2. **`asChild`** — shadcn's `Slot` merges props onto a child element via
   React cloning. mini has no cloneElement; the mini analogue is passing a
   factory or an already-built node and merging class/handlers onto it. This
   is a small `internal/` helper, designed once.

## Risks & open questions

- **Tailwind is a build-time dependency of the *consuming app*, not of
  mini.** mini ships class strings; the app must run Tailwind to produce CSS.
  The Tier-1 preset + docs must make this contract explicit, and an example
  app (`fixtures/` or a `docs/` demo) should prove the wiring end to end.
- **Behavioral parity is the real cost.** Getting Dialog focus-trap, scroll-
  lock, and `aria` semantics to match Radix is genuinely hard and is where
  accessibility regressions hide. Tier 3 should be scoped per-component and
  each one needs interaction tests (mini already tests DOM behavior — see
  `src/flow/*.test.tsx`).
- **Version drift.** shadcn's classes change over time. We are copying a
  snapshot, not tracking upstream; the plan should pin a shadcn version in
  the docs and treat updates as deliberate.
- **`@floating-ui/dom` dependency** for Tier 3 positioning breaks mini's
  "one runtime dependency" boast — but only for the `/ui/overlay` subpath,
  which the core `.` entry and Tier 1/2 never import. Acceptable under the
  existing per-subpath dependency model; the size-budget test on `.` stays
  green.

## Recommended sequencing

1. **Tier 1 — foundation.** Token CSS + Tailwind preset + `cn`/`cva`
   re-export + one example app wiring it up. Unblocks everything, tiny
   surface, no behavioral risk. *This is the smallest useful PR.*
2. **Tier 2 — presentational set.** Button, Badge, Card, Alert, Input,
   Label, Separator, Skeleton, Textarea, Avatar. Mechanical; each is a small
   PR with a render test asserting the class output matches shadcn.
3. **Tier 3 — interactive, one primitive at a time.** Build the shared
   `overlay` behaviors (Portal, focusTrap, dismiss, anchor) first, then
   Dialog → Popover → Dropdown → Select → Tabs → Tooltip, each with
   interaction + a11y tests. Multi-PR effort.

## Bottom line

**Can we?** Yes — with the asterisk that "shadcn-compatible" means a
mini-native port that reuses shadcn's *design system* (tokens, `cn`, `cva`,
class strings, component API), not its React runtime. Tiers 1 and 2 are
low-risk and high-value and could land quickly. Tier 3 is real engineering —
reimplementing Radix's accessibility behavior on mini's signals — and should
be scoped and reviewed component by component.
