---
"@amritk/api": minor
---

Add `streamMultipart` (and `multipartBoundary`) — a streaming
`multipart/form-data` parser for large file uploads. Where the pipeline's
built-in multipart handling buffers the whole body via `Response.formData`,
this yields each part with its bytes streamed, so a multi-gigabyte upload flows
through at constant memory. Reach it from a handler through `request.raw`.
Purely additive — the existing buffered path is unchanged.
