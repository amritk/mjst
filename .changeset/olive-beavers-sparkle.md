---
'@amritk/mjst': minor
---

`--validators` now emits one directory instead of two, and there is a new
`--check`.

**What changes for you.** A run with `--validators` used to produce two trees:
the parsers at the output root, and a parallel `validators/` subtree holding
`validateX` / `isX`. It produced two of everything, including two declarations of
the same `X` — structurally identical, but two things to keep in step, and two
import paths to remember. There is now one tree:

```
workflow.ts         export type Workflow, plus isWorkflow / validateWorkflow
workflow.parse.ts   parseWorkflow, importing the type from ./workflow
validation-result.ts
index.ts            a barrel over all of it
```

So `import { validateWorkflow } from './generated/validators/index.js'` becomes
`import { validateWorkflow } from './generated/index.js'`, and the parser half
moves from `workflow.ts` to `workflow.parse.ts`. Under `--schema-dir` and
`--input asyncapi` the same thing happens per schema: each schema's own
subdirectory carries both halves, and the top-level `validators/` mirror is gone.
Importing from the generated `index` — which is what the README has always shown
— you will not notice the move at all; a deep import into `validators/…` needs
the path updated.

Only runs asking for validators change shape. `mjst generate --out-dir …` on its
own, with `--types-only`, or with `--strict`, emits exactly the files and names it
emitted before: with no validator half there is nothing to collide with, so the
parser keeps `workflow.ts` and its own type, and no `validation-result.ts` is
written.

The point of it is that there is now exactly one `export type Workflow` in the
output, and the guard, the validator and the parser are all talking about it. Two
trees could only promise that; one directory means it.

**`--check`.** A new flag, gated behind `--validators` like `--coerce` and
`--repair`, emitting `checkX` beside `validateX`. It returns the same
`ValidationResult`, carrying only the error that stopped it: where `validateX`
walks the whole document to collect every violation, `checkX` gives up at the
first and costs a single error object. Reach for it when a failure has to be
reported but only the first thing wrong matters — a service refusing to boot on a
bad config does not need the other nine. When nothing has to be reported at all,
`isX` is cheaper still, since it builds no error object.

Under the hood the CLI now drives `@amritk/parsers` — one call, one options
object — instead of calling `@amritk/generate-parsers` and
`@amritk/generate-validators` positionally and stitching their output together.
One consequence worth naming: `--unknown-keys` reached the validators but was
silently dropped for the parsers on the `--input asyncapi` path. It now reaches
both.
