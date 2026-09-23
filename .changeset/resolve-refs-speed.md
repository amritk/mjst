---
"@amritk/resolve-refs": minor
---

Resolve references faster, and read JSON Pointer array indices strictly.

- A repeated reference is answered from the cache before its pointer is parsed or its anchor searched for, pointer segments with nothing to decode skip decoding, and the resource and anchor walks share one path array instead of copying it per node. `resolveRefs` on the OpenAI API schema takes about 40% less time, and 50–80% less on schemas that reuse definitions heavily. Output is unchanged.
- **Behavior change:** an array index in a pointer must be spelled as RFC 6901 says (`0`, or digits with no leading zero). `#/allOf/0x1`, `#/allOf/01`, `#/allOf/1e0` and `#/allOf/` used to land on an element; they are now unresolvable and reported in `errors`.
