---
'@amritk/mini': patch
---

Fix `list` silently killing every rendered row when the collection changes.

alien-signals disposes a scope created inside a running effect as soon as that
effect re-runs, and `list` built each row's `effectScope` inside its
reconciliation effect. Appending a single row therefore disposed the scope of
every row already on screen: the nodes stayed in the document looking perfectly
correct while all of their bindings quietly stopped updating, and each surviving
row's `onCleanup` fired as if the row had been removed.

Row scopes are now built through a new `runDetached` helper, so row lifetime
belongs to `list` — which disposes a row when its key disappears, and all of them
when it is torn down. `list` also registers its teardown with `onCleanup`, so
unmounting the component that created the list still disposes every row.
