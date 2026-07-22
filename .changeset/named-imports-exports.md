---
"@amritk/lint": patch
"@amritk/api": patch
---

Use named imports and exports throughout instead of `import * as` / `export *`.
The lint package's barrel files now enumerate their re-exports explicitly (the
public API surface is unchanged), and the API docs demonstrate building a
contracts/routes record from named imports rather than a namespace import.
