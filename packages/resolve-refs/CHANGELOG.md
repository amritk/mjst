# @amritk/resolve-refs

## 0.1.0

### Minor Changes

- 6fdb8bf: Add `@amritk/resolve-refs`: resolve and inline JSON Schema / OpenAPI `$ref`s —
  internal pointers, cross-file refs, and remote (http/https) documents — into a
  single dereferenced document. One-pass with per-session caching of fetched
  remote documents, cycle-safe, and guarded by a default-deny SSRF check
  (loopback / private / link-local / cloud-metadata hosts are refused unless
  explicitly allow-listed).
