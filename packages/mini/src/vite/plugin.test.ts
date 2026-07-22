import type { Plugin } from 'vite'
import { describe, expect, it } from 'vitest'

import { catchCalledSignals } from './plugin'

/**
 * The reports one `transform` run produced. `error` throws like Rollup's real
 * `this.error` so we can assert the build-gate path aborts.
 */
type Reports = { warnings: string[]; errors: string[] }

const contextFor = (reports: Reports) => ({
  warn: (payload: { message: string }) => {
    reports.warnings.push(payload.message)
  },
  error: (message: string): never => {
    reports.errors.push(message)
    throw new Error(message)
  },
})

/**
 * Runs the plugin's `transform` against a mock context. Vite types the hook as
 * an object-or-function; we take the function form (the shape the plugin uses)
 * and bind our mock as `this` — the one cast a hand-mocked plugin context needs.
 */
const runTransform = (plugin: Plugin, reports: Reports, code: string, id: string): void => {
  const hook = plugin.transform
  const handler = typeof hook === 'function' ? hook : hook?.handler
  const run = handler as (this: ReturnType<typeof contextFor>, code: string, id: string) => unknown
  run.call(contextFor(reports), code, id)
}

/** Applies `configResolved` so the plugin knows whether it is a build or a dev serve. */
const resolveConfig = (plugin: Plugin, command: 'build' | 'serve'): void => {
  const hook = plugin.configResolved
  const handler = typeof hook === 'function' ? hook : hook?.handler
  // The plugin only reads `config.command`, so a minimal object is enough.
  const run = handler as (config: { command: 'build' | 'serve' }) => unknown
  run({ command })
}

/** Every payload the overlay path pushed over the dev server's WebSocket. */
type Overlay = { type: string; err: { message: string; frame?: string; loc?: { line: number } } }

/** Attaches a mock dev server so the plugin's overlay branch has a `ws.send` to call. */
const attachServer = (plugin: Plugin, sent: Overlay[]): void => {
  const hook = plugin.configureServer
  const handler = typeof hook === 'function' ? hook : hook?.handler
  const run = handler as (server: { ws: { send: (payload: Overlay) => void } }) => unknown
  run({ ws: { send: (payload) => sent.push(payload) } })
}

// A signal must be declared for the signal-aware scanner to flag its call.
const FOOTGUN = 'const streaming = signal(false); export const a = <button disabled={streaming()}>x</button>'

describe('catch-called-signals plugin', () => {
  it('warns on a frozen binding during dev without failing', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'serve')

    runTransform(plugin, reports, FOOTGUN, '/app/widget.tsx')

    expect(reports.warnings).toHaveLength(1)
    expect(reports.warnings[0]).toContain('disabled={streaming}')
    expect(reports.errors).toEqual([])
  })

  it('fails the build when a frozen binding is found', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'build')

    expect(() => runTransform(plugin, reports, FOOTGUN, '/app/widget.tsx')).toThrow()
    // The finding is still surfaced as a warning before the build aborts.
    expect(reports.warnings).toHaveLength(1)
    expect(reports.errors).toHaveLength(1)
  })

  it('honours an explicit failOnError override during dev', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals({ failOnError: true })
    resolveConfig(plugin, 'serve')

    expect(() => runTransform(plugin, reports, FOOTGUN, '/app/widget.tsx')).toThrow()
  })

  it('pushes a dev overlay for a frozen binding', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const sent: Overlay[] = []
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'serve')
    attachServer(plugin, sent)

    runTransform(plugin, reports, FOOTGUN, '/app/widget.tsx')

    expect(sent).toHaveLength(1)
    expect(sent[0]?.type).toBe('error')
    expect(sent[0]?.err.message).toContain('disabled={streaming}')
    expect(sent[0]?.err.frame).toContain('^')
    expect(sent[0]?.err.loc?.line).toBe(1)
  })

  it('does not push an overlay when overlay is disabled', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const sent: Overlay[] = []
    const plugin = catchCalledSignals({ overlay: false })
    resolveConfig(plugin, 'serve')
    attachServer(plugin, sent)

    runTransform(plugin, reports, FOOTGUN, '/app/widget.tsx')

    expect(reports.warnings).toHaveLength(1)
    expect(sent).toEqual([])
  })

  it('warns on a called signal used as a child', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'serve')

    runTransform(plugin, reports, 'const count = signal(0); const a = <span>{count()}</span>', '/app/widget.tsx')

    expect(reports.warnings).toHaveLength(1)
    expect(reports.warnings[0]).toContain('{count()}')
    expect(reports.warnings[0]).toContain('pass {count}')
  })

  it('ignores non-tsx modules', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'serve')

    runTransform(plugin, reports, FOOTGUN, '/app/logic.ts')

    expect(reports.warnings).toEqual([])
  })

  it('ignores virtual modules', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'serve')

    runTransform(plugin, reports, FOOTGUN, '\0virtual:widget.tsx')

    expect(reports.warnings).toEqual([])
  })

  it('scans a tsx module even with a query suffix', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'serve')

    runTransform(plugin, reports, FOOTGUN, '/app/widget.tsx?v=123')

    expect(reports.warnings).toHaveLength(1)
  })

  it('stays silent on a clean module', () => {
    const reports: Reports = { warnings: [], errors: [] }
    const plugin = catchCalledSignals()
    resolveConfig(plugin, 'build')

    runTransform(
      plugin,
      reports,
      'const streaming = signal(false); const a = <button disabled={streaming}>x</button>',
      '/app/widget.tsx',
    )

    expect(reports.warnings).toEqual([])
    expect(reports.errors).toEqual([])
  })
})
