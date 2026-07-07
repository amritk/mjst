import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { run } from './run'

const RULESET = [
  'rules:',
  '  needs-name:',
  '    given: "$"',
  '    severity: error',
  '    then: { field: name, function: truthy }',
].join('\n')

describe('cli concurrency', () => {
  it('produces the same findings regardless of the --concurrency setting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-conc-'))
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    for (let i = 0; i < 20; i++) writeFileSync(join(dir, `doc${i}.yaml`), 'version: 1\n')
    const glob = join(dir, 'doc*.yaml')

    const serial = await run([glob, '--concurrency', '1'])
    const parallel = await run([glob, '--concurrency', '16'])

    // Byte-identical output — order is stable (input order) and complete either way.
    expect(serial.stdout).toBe(parallel.stdout)
    expect(serial.code).toBe(1)
    // Every one of the 20 files contributed its finding.
    for (let i = 0; i < 20; i++) expect(serial.stdout).toContain(`doc${i}.yaml`)
  })

  it('reports each document under its own source, once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-conc2-'))
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.yaml`), 'version: 1\n')
    const { stdout } = await run([join(dir, 'f*.yaml')])
    // One finding line per file plus the two-line summary.
    const findingLines = stdout.split('\n').filter((l) => l.includes('needs-name'))
    expect(findingLines).toHaveLength(5)
  })
})
