/// <reference types="node" />
// Needs Node's zlib/url to bundle and gzip the core; pulled in explicitly
// because the package's tsconfig is browser-only (`types: []`) to keep the
// shipped sources off the Node ambient types.

import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The real safety net behind "zero bytes added to the widget bundle."
 *
 * The bundle-size-sensitive widget imports mini's `.` entry, so the size of
 * that entry — bundled and gzipped exactly as a consumer ships it — is the
 * number that must not move when subpath features are added. This bundles the
 * core through esbuild with a metafile and asserts two things: the gzipped size
 * stays under budget, and the built module graph contains only core sources and
 * `alien-signals`. Import a subpath into core and this test fails on both
 * counts, before the widget ever grows.
 *
 * The budget is deliberately snug against the measured size (~2.4 KB gzipped):
 * a leaked subpath adds far more than the headroom, so a real regression cannot
 * hide under it. Bump it only for an intentional, reviewed change to the core.
 */

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Gzipped-byte ceiling for the bundled `.` entry. */
const GZIP_BUDGET = 2800

/** Feature directories whose sources must never enter the core graph. */
const SUBPATH_DIRS = ['flow/', 'router/', 'forms/', 'query/', 'internal/']

const built = await build({
  entryPoints: ['src/index.ts'],
  absWorkingDir: PKG_ROOT,
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  metafile: true,
  platform: 'browser',
  target: 'es2022',
})

const output = built.outputFiles[0]?.contents ?? new Uint8Array()
const inputs = Object.keys(built.metafile.inputs)

describe('core-size-budget', () => {
  it('stays under the gzipped byte budget', () => {
    const gzipped = gzipSync(output).length
    expect(gzipped).toBeLessThanOrEqual(GZIP_BUDGET)
  })

  it('bundles only core sources and alien-signals', () => {
    const offenders = inputs.filter((input) => {
      if (input.includes('alien-signals')) return false
      if (input.startsWith('src/') && !SUBPATH_DIRS.some((dir) => input.startsWith(`src/${dir}`))) return false
      return true
    })
    expect(offenders).toEqual([])
  })

  it('pulls in no other node_modules package', () => {
    const packages = inputs.filter((input) => input.includes('node_modules'))
    for (const input of packages) expect(input).toContain('alien-signals')
  })
})
