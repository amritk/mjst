---
"@amritk/lint": patch
---

`oas3-valid-schema-example` and `oas3-valid-media-example` validate an example again after the data it sits in is edited in place. Both memoize results by node identity, and that memo lived for the whole process, so linting the same `{ data }` again (or rerunning `linter.run(document)` after changing `document.data`) reported what the node said the first time: an example made invalid by the edit went unreported. The memo now lasts one run. Results within a run, and the time a run takes, are unchanged.
