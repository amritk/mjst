---
'@amritk/mini-native': minor
---

Add `@amritk/mini-native` — a React-Native-shaped UI runtime built the way `@amritk/mini` builds for the DOM: real host nodes created once, mutated forever by signals, with no virtual tree in between.

That absence is what makes the port tractable. The hard part of a React-style native framework is the reconciler; there is none here to port, so targeting a platform means implementing one `Host` — about 15 functions — and nothing else.

- **`Host`** is the entire platform surface, installed once per context with `setHost`. Module-level host injection comes with a flush scheduler that coalesces a tick of mutations into a single commit for targets that batch.
- **A compilerless JSX runtime typed against a native element vocabulary** (`view`/`text`/`image`/`scroll-view`/`input`) rather than HTML. That inversion keeps the DOM library out of the core and makes the browser a preview target for a native app instead of the other way around; the main `tsconfig` omits `lib.dom` so the compiler enforces it, and the DOM host is checked separately by `tsconfig.dom.json`.
- **`list`** is the only reconciler, over four host operations.
- **`Show`, `Dynamic`, and `For`** each render into a wrapper the host supplies — `display: contents` on the web, an ordinary container view natively.
- **Three hosts** — an in-memory reference host, a DOM preview host, and a Lynx host driving the Element PAPI. Lynx keeps only one listener per event, so that host registers a dispatcher and fans out itself.

It also carries a fix for a scope-ownership bug inherited from mini's design: a scope created inside a running effect is disposed when that effect re-runs, so appending one list row would dispose every row already on screen — nodes left in place looking correct while all their bindings quietly stopped updating. `run-detached.ts` hands that lifetime back to `list` and `renderChild`, covered by a regression test that fails without it.
