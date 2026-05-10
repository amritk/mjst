<div align="center">

# @amritk/generate-markdown

**Generate markdown documentation from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.1.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![bun](https://img.shields.io/badge/bun-required-FBF0DF?style=flat-square&logo=bun&logoColor=000000)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe%20coded-100%25-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-markdown` renders a single configuration reference table from a `config.schema.json` file and writes the result to `README.md`. It exists so the documentation for a CLI's flags can be regenerated from the schema itself, keeping the two in sync.

It picks up two non-standard keywords from each property to produce richer output:

- `x-cli-flag` — the matching CLI flag (e.g. `--schema <path>`)
- `x-icon` — an emoji shown in the leading column of the table

---

## Installation

```bash
npm install @amritk/generate-markdown
# or
pnpm add @amritk/generate-markdown
# or
bun add @amritk/generate-markdown
```

---

## Usage

```ts
import { generateMarkdown } from '@amritk/generate-markdown'

await generateMarkdown()
// Reads ./config.schema.json from process.cwd()
// Writes ./README.md
```

The generator currently expects:

- `config.schema.json` — the source schema, located relative to the current working directory
- Each property may declare `description`, `default`, `x-cli-flag`, and `x-icon`

The output is a single Markdown table with the columns: icon, property, CLI flag, type, required, default, description.

---

## API

### `generateMarkdown(): Promise<void>`

No arguments. Reads from `${cwd}/config.schema.json` and writes to `${cwd}/README.md`.

---

## Related packages

- [`@amritk/mjst`](../cli) — uses this package to keep its README's flag table in sync with `config.schema.json`
- [`@amritk/generate-parsers`](../generate-parsers) — sibling generator for TypeScript parsers and types
- [`@amritk/generate-validators`](../generate-validators) — sibling generator for predicate validators

---

## License

[MIT](../../LICENSE)
