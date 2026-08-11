---
'@amritk/api': patch
---

Settle a body read on a stream that was already destroyed. The `readableEnded`
guard covers a stream an upstream parser drained, but not one the client
aborted: `readableEnded` is false there, and the body is read lazily — only
when a route asks — so a handler that awaits anything first leaves a window in
which 'close', 'end' and 'error' have all already fired. The listeners attached
after that could never run, so the promise never settled and the request task
leaked for the life of the process. `destroyed`/`readableAborted` are now
checked alongside `readableEnded`.
