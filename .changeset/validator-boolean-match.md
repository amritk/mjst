---
"@amritk/validation": patch
---

Generated validators answer an `anyOf` / `oneOf` / `not` / `if` / `contains` branch with a plain `return false` when its errors are discarded (the default, without `branchErrors`), instead of building every error into a throwaway buffer. A valid member of an inline three-branch union no longer allocates an error object per branch it does not match: `validateX`, `isX` and `checkX` on such a schema run 6–8× faster, and the emitted file is smaller. A branch whose body would report unconditionally keeps the buffer form.
