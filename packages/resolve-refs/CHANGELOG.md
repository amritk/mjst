# @amritk/resolve-refs

## 0.1.2

### Patch Changes

- abab839: Percent-decode URI-encoded segments in `getByPointer` before applying `~1`/`~0` unescaping, so keys like `{volume_id}` encoded as `%7Bvolume_id%7D` resolve correctly and `%2F` within a segment is never treated as a path separator.

## 0.1.1

### Patch Changes

- 6218978: chore: version bumps

## 0.1.0

### Minor Changes

- 6fdb8bf: Add `@amritk/resolve-refs`: resolve and inline JSON Schema / OpenAPI `$ref`s —
  internal pointers, cross-file refs, and remote (http/https) documents — into a
  single dereferenced document. One-pass with per-session caching of fetched
  remote documents, cycle-safe, and guarded by a default-deny SSRF check
  (loopback / private / link-local / cloud-metadata hosts are refused unless
  explicitly allow-listed).
