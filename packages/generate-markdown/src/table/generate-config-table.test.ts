import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateConfigTable } from '#table/generate-config-table'

const SCHEMA = {
  title: 'Config',
  properties: { host: { type: 'string', description: 'The host.' } },
}

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

const writeSchema = (dir: string, name = 'config.schema.json'): string => {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(SCHEMA))
  return path
}

describe('generate-config-table', () => {
  // The point of the parameterized form: neither file has to be named what the
  // zero-argument `generateMarkdown` assumes, nor sit in the current directory.
  it('renders a named schema into a named markdown file', async () => {
    const dir = tmp('config-table-')
    const schemaPath = writeSchema(dir, 'settings.schema.json')
    const readmePath = join(dir, 'docs', 'config.md')
    writeFileSync(join(dir, 'config.schema.json'), '{ "properties": { "wrong": {} } }')

    const written = await generateConfigTable({ schemaPath, readmePath })

    expect(written).toBe(readmePath)
    const content = readFileSync(readmePath, 'utf-8')
    expect(content).toContain('<code>host</code>')
    expect(content).not.toContain('wrong')
  })

  // A file it created itself carries the markers, so the next run splices
  // instead of refusing.
  it('writes the markers when the file does not exist yet', async () => {
    const dir = tmp('config-table-new-')
    const schemaPath = writeSchema(dir)
    const readmePath = join(dir, 'REFERENCE.md')

    await generateConfigTable({ schemaPath, readmePath })
    const first = readFileSync(readmePath, 'utf-8')
    expect(first).toContain('<!-- config-table-start -->')
    expect(first).toContain('<!-- config-table-end -->')

    // Second run splices into its own output rather than appending to it.
    await generateConfigTable({ schemaPath, readmePath })
    expect(readFileSync(readmePath, 'utf-8')).toBe(first)
  })

  // The refusal names the file it declined to overwrite — with two packages
  // documenting two schemas in one command, "README.md" alone does not say
  // which one needs the markers.
  it('names the file it refuses to overwrite', async () => {
    const dir = tmp('config-table-refuse-')
    const schemaPath = writeSchema(dir)
    const readmePath = join(dir, 'HAND-WRITTEN.md')
    writeFileSync(readmePath, '# Mine\n')

    await expect(generateConfigTable({ schemaPath, readmePath })).rejects.toThrow(/HAND-WRITTEN\.md exists without/)
    expect(readFileSync(readmePath, 'utf-8')).toBe('# Mine\n')
  })
})
