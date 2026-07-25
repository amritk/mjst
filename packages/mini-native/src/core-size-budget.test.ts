/// <reference types="node" />
// Needs Node's zlib/url to bundle and gzip the core; pulled in explicitly
// because the package's tsconfig is deliberately platform-free (`lib:
// ["ESNext"]`, `types: []`) to keep the shipped sources off both the DOM and
// the Node ambient types.

import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The number behind "the core carries no platform", made checkable.
 *
 * An app imports the `.` entry and then exactly one host, so the size of that
 * entry — bundled and gzipped the way a consumer actually ships it — is what
 * every caller pays before rendering a single view. This bundles the core
 * through esbuild with a metafile and asserts two things: the gzipped size
 * stays under budget, and the built module graph contains only core sources and
 * `alien-signals`. Import a host or a control-flow component into core and this
 * fails on both counts.
 *
 * The bundle is built for the `neutral` platform, which is the honest setting
 * for a runtime that targets none: nothing here may resolve through a browser
 * or Node field, and asking esbuild to assume either would quietly excuse it.
 *
 * The budget is snug against the measured size — 3084 bytes gzipped at the time
 * of writing — on purpose. The smallest thing that could leak in is a host at
 * roughly 700 bytes and `/flow` is several times that, so a real regression
 * cannot hide in the headroom. Raise it only for a deliberate, reviewed change
 * to the core, the way the last few hundred bytes were spent: the naive cursor
 * reconciler became a move-minimal two-ended keyed diff (O(1) middle removals
 * and single-move reorders), and `batch`, `watch`, and `untrack` were added.
 */

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Gzipped-byte ceiling for the bundled `.` entry. */
const GZIP_BUDGET = 3300

/** Subpath directories whose sources must never enter the core graph. */
const SUBPATH_DIRS = ['hosts/', 'flow/']

const built = await build({
  entryPoints: ['src/index.ts'],
  absWorkingDir: PKG_ROOT,
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  metafile: true,
  platform: 'neutral',
  target: 'es2022',
})

const inputs = Object.keys(built.metafile.inputs)

describe('core-size-budget', () => {
  it('produces exactly one non-empty output file', () => {
    // Guards the measurement itself: an empty output would gzip to a handful of
    // bytes and pass the budget green, silently disarming the whole safety net.
    expect(built.outputFiles).toHaveLength(1)
    expect(built.outputFiles[0]?.contents.length ?? 0).toBeGreaterThan(0)
  })

  it('stays under the gzipped byte budget', () => {
    const output = built.outputFiles[0]?.contents ?? new Uint8Array()
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
    // A real assertion in both directions: every node_modules input must be
    // alien-signals, so a non-alien dependency shows up as a non-empty offenders
    // list rather than an empty loop that can only fail, never meaningfully pass.
    const foreign = inputs.filter((input) => input.includes('node_modules') && !input.includes('alien-signals'))
    expect(foreign).toEqual([])
  })
})
