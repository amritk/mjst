import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Marks every `bin` target of the package in the current working directory as
// executable. `npm pack` records each file's on-disk mode in the tarball, and
// tsgo writes dist/cli.js as 0644 — so the shipped tarball carried a
// non-executable bin. Package managers chmod bin targets when they link them,
// which hides the problem for `npm i` / `npx`, but flows that consume the
// tarball directly (vendoring, Docker `npm pack` + `tar -x`, some monorepo
// caches) run the file as-is and fail with EACCES.
//
// Runs after the TypeScript build from the package root:
// `node ../../scripts/chmod-bin.mjs`.
//
// chmod is a no-op for permission bits on Windows (Node only maps the
// read-only flag), so this stays safe on a Windows `bun run build`.

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const targets = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})

for (const target of targets) {
  const path = join(process.cwd(), target)
  if (!existsSync(path)) throw new Error(`bin target "${target}" does not exist — did the build run?`)
  // Preserve the existing bits, add execute wherever read is already granted.
  const mode = statSync(path).mode & 0o777
  chmodSync(path, mode | ((mode & 0o444) >> 2))
}
