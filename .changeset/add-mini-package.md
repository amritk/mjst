---
"@amritk/mini": minor
---

Add `@amritk/mini` — a deliberately tiny signals-based UI layer built on `alien-signals`. Provides fine-grained reactivity (`signal`, `computed`, `effect`, `effectScope`, `batch`, `watch`, `onCleanup`), a capped set of DOM bindings that keep data off the `innerHTML` XSS surface (`bindText`, `bindAttr`, `bindClass`, `bindShow`, `bindValue`, and the single sanctioned `bindHtml` sink), keyed reactive collections (`list`) and static-template cloning (`template`), and a compilerless JSX runtime (`@amritk/mini/jsx-runtime`) whose reactivity is decided by value shape at runtime — a function-valued attribute or child is a live binding, everything else is applied once.
