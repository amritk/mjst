---
"@amritk/generate-markdown": minor
"@amritk/mjst": minor
---

Read documentation settings from `x-mjst` instead of `x-doc`.

The docs now share mjst's one vendor extension with the type generators, and a key means what its position says. Everything the markdown renderer reads moves under `x-mjst.markdown` — on the root it configures the pages, on a property it documents that property — and `hidden`, which is not about markdown in particular, sits on `x-mjst` itself beside hints like `brand`:

```json
{
  "x-mjst": { "markdown": { "pages": [{ "id": "advanced", "file": "advanced.md" }], "table": { "required": "*" } } },
  "properties": {
    "userId": { "type": "string", "x-mjst": { "brand": "UserId", "markdown": { "page": "advanced" } } },
    "debugToken": { "type": "string", "x-mjst": { "hidden": true } }
  }
}
```

A `$ref` site's `x-mjst` still merges with its definition's key by key, and `markdown` merges key by key again, so a ref site that names a page or adds a brand keeps the definition's examples.

**Breaking:** `x-doc` is no longer read. Move `"x-doc": { … }` to `"x-mjst": { "markdown": { … } }`, and `x-doc.hidden` to `x-mjst.hidden`.
