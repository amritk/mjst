# Contributing to mjst

Thanks for your interest. mjst is pre-alpha; the surface area is still moving, so opening an issue first is the fastest path for anything beyond a small fix.

## Getting started

```bash
git clone https://github.com/amritk/mjst.git
cd mjst
bun install
```

You'll need [Bun](https://bun.sh) ≥ 1.1.

## Common commands

| Command | What it does |
|---|---|
| `bun test` | Run the full test suite |
| `bun run check` | Lint with biome |
| `bun run format` | Auto-format with biome |
| `bun run build` | Build all publishable packages |

## Workflow

1. Create a branch off `main`.
2. Make your changes. Add tests for new behaviour.
3. Run `bun run check`, `bun test`, and `bun run build` locally.
4. Add a changeset describing your change:
   ```bash
   bunx changeset
   ```
   Pick the affected packages and a semver bump. The release workflow turns this into a version PR + npm publish on merge to `main`.
5. Open a pull request.

## Code style

- TypeScript style, formatting, and conventions are enforced by [Biome](./biome.json) — run `bun run format` before pushing.
- Project-specific guidelines live in [`.claude/`](./.claude):
  - `typescript.md` — type-level conventions
  - `bun.md` — Bun-specific APIs
  - `comments.md` — when (and when not) to write comments
  - `testing.md` — how tests are organized
  - `architecture.md` — monorepo layout and design

## Reporting issues

Use the [issue tracker](https://github.com/amritk/mjst/issues). Please include:

- mjst version (or commit SHA)
- A minimal JSON Schema that reproduces the problem
- Expected vs. actual generated output

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities.

## License

By contributing you agree your contributions will be licensed under the [MIT License](./LICENSE).
