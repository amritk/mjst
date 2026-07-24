---
'@amritk/mini': minor
---

`<Show>` can pass the narrowed value to a function child. `<Show when={user}>`
now accepts `{(user) => …}`, where `user` is a getter with `null`/`undefined`
removed from its type — so the branch reads the value that satisfied `when`
without repeating the signal or a non-null assertion. The value arrives as a
getter, so a truthy→truthy change updates it reactively without rebuilding the
branch (a focused input inside it survives), and the getter returns the last
truthy value so a read that races the branch's teardown can never throw. The
existing node and zero-argument factory child forms are unchanged.
