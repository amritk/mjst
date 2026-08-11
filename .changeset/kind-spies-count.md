---
'@amritk/lint': patch
---

Guard alias registration, not just alias lookup. The alias grammar accepts
`#constructor`, and `registerAlias` read the definition off `Object.prototype`
— truthy, so the "references undefined alias" throw was skipped — then wrote
that prototype member into the table as a real own key. The `Object.hasOwn`
guard on the lookup side could not help after that: the name genuinely was own,
and the missing `.targets` threw out of the whole lint run, which is the crash
the previous round reported as fixed. Registration now asks `Object.hasOwn` on
every read and writes through a `__proto__`-safe assignment.
