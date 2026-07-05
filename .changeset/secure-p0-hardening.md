---
"@amritk/resolve-refs": patch
"@amritk/runtime-validators": patch
"@amritk/generate-validators": patch
"@amritk/generate-parsers": patch
"@amritk/helpers": patch
"@amritk/yaml": patch
---

Security and robustness hardening:

- **resolve-refs**: the SSRF guard now rejects non-`http(s)` redirect targets, so a
  remote schema can no longer bounce a fetch to `file://`/`data:` and disclose
  local files; remote fetches also gain a timeout and a response-size cap.
- **generate-parsers / generate-validators / helpers**: schema-controlled strings
  (property names, enum values, patterns, required keys) are now escaped via
  `JSON.stringify` before being emitted into generated TypeScript. Previously a
  crafted enum value or property name could break out of — or inject code into —
  the generated output.
- **runtime-validators**: recursive `$ref` schemas (e.g. `{ $ref: '#' }`) no longer
  overflow the stack; property presence is checked with `Object.hasOwn`, fixing a
  false-accept of an inherited `constructor` and a false-reject of a real
  `__proto__` property.
- **yaml**: alias expansion is bounded (billion-laughs protection) and parser
  nesting is depth-limited, so a tiny adversarial document can no longer hang the
  process or overflow the stack.
- **helpers / yaml / resolve-refs**: `__proto__` keys in untrusted input are stored
  as own data instead of mutating an object's prototype.
