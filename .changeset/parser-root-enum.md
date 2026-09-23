---
"@amritk/validation": patch
---

Fix `parseX` for a root `enum` with an object or array member. Membership was tested with `[…].includes(input)`, which compares by reference, so a valid `{ "a": 1 }` against `enum: [{ "a": 1 }]` was never found and the parser replaced it with the first member. It now tests each member the way the property path does, deep for a structural member, and no longer builds the array on every call.
