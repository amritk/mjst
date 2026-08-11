---
'@amritk/adapters': patch
---

Test for `items` / `additionalItems` with `Object.hasOwn` rather than `in`. A
polluted `Object.prototype.items` made every `prefixItems` tuple look like it
had a rest element, so `items: false` was never written and extra trailing
elements slipped through — the exact under-validation `enforceTupleLength`
exists to close. A polluted `additionalItems` inverted the other one, turning a
closed draft-07 tuple into an open one.
