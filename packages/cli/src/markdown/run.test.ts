import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { run } from './run'

const SCHEMA = {
  title: 'Config',
  description: 'The config.',
  required: ['host'],
  'x-extra-columns': { 'x-scalar-stability': 'Stability' },
  properties: {
    host: { type: 'string', description: 'The host to bind.', 'x-scalar-stability': 'experimental' },
    port: { type: 'number', description: 'The port to bind.', default: 3000 },
  },
}

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

const writeSchema = (dir: string, schema: unknown = SCHEMA): string => {
  const path = join(dir, 'config.schema.json')
  writeFileSync(path, JSON.stringify(schema))
  return path
}

describe('run', () => {
  it('writes the prose reference pages', async () => {
    const dir = tmp('markdown-docs-')
    const schema = writeSchema(dir)
    const { code, stdout, stderr } = await run([schema, '--out-dir', dir])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('Generated:')
    const page = readFileSync(join(dir, 'index.md'), 'utf-8')
    expect(page).toContain('# Config')
    expect(page).toContain('host')
  })

  it('passes the page options through to the generator', async () => {
    const dir = tmp('markdown-options-')
    const schema = writeSchema(dir)
    const { code, stderr } = await run([schema, '--out-dir', dir, '--file', 'config.md', '--title', 'Options'])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'config.md'), 'utf-8')).toContain('# Options')
  })

  // --table is the other shape the package renders: one HTML table spliced into
  // a file that keeps everything outside the markers.
  it('splices the config table into the readme under --table', async () => {
    const dir = tmp('markdown-table-')
    const schema = writeSchema(dir)
    const readme = join(dir, 'README.md')
    writeFileSync(readme, '# Title\n\n<!-- config-table-start -->\n<!-- config-table-end -->\n\nKeep me.\n')
    const { code, stdout, stderr } = await run([schema, '--table', '--readme', readme])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('Generated config table')
    const content = readFileSync(readme, 'utf-8')
    expect(content).toContain('<th>Property</th>')
    expect(content).toContain('<code>host</code>')
    // The declared extra column rides along.
    expect(content).toContain('<th>Stability</th>')
    expect(content).toContain('<td>experimental</td>')
    expect(content).toContain('Keep me.')
  })

  // The refusal to clobber hand-written content is the table flow's load-bearing
  // safety check, and it has to reach the user as a failed run, not a stack trace.
  it('fails when the readme has no marker region', async () => {
    const dir = tmp('markdown-no-markers-')
    const schema = writeSchema(dir)
    const readme = join(dir, 'README.md')
    writeFileSync(readme, '# Hand-written\n')
    const { code, stderr } = await run([schema, '--table', '--readme', readme])
    expect(code).toBe(1)
    expect(stderr).toContain('config-table-start')
    expect(readFileSync(readme, 'utf-8')).toBe('# Hand-written\n')
  })

  it('reports a malformed schema instead of throwing', async () => {
    const dir = tmp('markdown-bad-json-')
    const path = join(dir, 'config.schema.json')
    writeFileSync(path, '{ nope')
    const { code, stderr } = await run([path, '--out-dir', dir])
    expect(code).toBe(1)
    expect(stderr).toContain('not valid JSON')
  })

  it('prints the help for --help and for no arguments', async () => {
    expect((await run([])).stdout).toContain('mjst markdown')
    expect((await run(['--help'])).stdout).toContain('mjst markdown')
  })

  it('requires a schema path', async () => {
    const { code, stderr } = await run(['--out-dir', 'docs'])
    expect(code).toBe(2)
    expect(stderr).toContain('schema path is required')
  })

  // A page flag under --table would be a silently ignored option, and the user
  // would sit waiting for pages that were never going to be written.
  it('rejects a page flag combined with --table', async () => {
    const { code, stderr } = await run(['config.schema.json', '--table', '--out-dir', 'docs'])
    expect(code).toBe(2)
    expect(stderr).toContain('--out-dir')
  })

  it('rejects --readme without --table', async () => {
    const { code, stderr } = await run(['config.schema.json', '--readme', 'README.md'])
    expect(code).toBe(2)
    expect(stderr).toContain('requires --table')
  })

  it('rejects an unknown flag', async () => {
    const { code, stderr } = await run(['config.schema.json', '--nope', 'x'])
    expect(code).toBe(2)
    expect(stderr).toContain('Unknown flag "--nope"')
  })
})
