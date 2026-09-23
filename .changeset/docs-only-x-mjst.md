---
"@amritk/helpers": patch
"@amritk/validation": patch
---

An `x-mjst` holding only documentation settings (`hidden`, `markdown`) no longer changes generated code. The validator generator and the type generator used to treat the presence of `x-mjst` as a keyword that shapes a node, so a root `$ref` that named its docs pages lost its one-line delegation, and an `if` fragment carrying a docs setting dropped its conditional from the TypeScript type. They now ask whether `x-mjst` carries a generator hint (`instanceOf`, `primitive`, `brand`, `discriminator`), via the new `hasMjstHint` in `@amritk/helpers/mjst-extension`.
