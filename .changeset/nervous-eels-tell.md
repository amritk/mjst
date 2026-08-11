---
'@amritk/api': patch
---

Test the regex backoff against a `/` the scanner actually guesses at. The case
pinning it used `a / b`, where `previous` is `a` and the regex branch is never
entered — so deleting the backoff left the test green. It now follows a `*`,
which does enter the branch and does span the call site. The check itself drops
the `slice` for an `indexOf` bound, so it no longer copies each candidate regex
body.
