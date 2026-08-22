import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateDocs } from '#reference/generate-docs'

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

const mkdirMock = vi.mocked(mkdir)
const readFileMock = vi.mocked(readFile)
const writeFileMock = vi.mocked(writeFile)

/** Serves one schema, whatever path is asked for. */
const mockSchema = (schema: unknown): void => {
  readFileMock.mockImplementation(async () => JSON.stringify(schema))
}

/** The `(path, content)` pairs `generateDocs` wrote, in order. */
const written = (): readonly (readonly [string, string])[] =>
  writeFileMock.mock.calls.map(([path, content]) => [String(path), String(content)] as const)

const multiPage = {
  title: 'Configuration',
  'x-doc': {
    file: 'configuration.md',
    pages: [{ id: 'ts', file: 'configuration/typescript.md', title: 'TypeScript' }],
  },
  properties: {
    name: { type: 'string' },
    typescript: { type: 'object', 'x-doc': { page: 'ts' }, properties: { packageName: { type: 'string' } } },
  },
}

describe('generate-docs', () => {
  beforeEach(() => {
    mkdirMock.mockReset()
    readFileMock.mockReset()
    writeFileMock.mockReset()
    mkdirMock.mockImplementation(async () => undefined)
    writeFileMock.mockImplementation(async () => {})
  })

  it('reads config.schema.json from the working directory by default', async () => {
    mockSchema({ title: 'Config' })

    await generateDocs()

    expect(String(readFileMock.mock.calls[0]?.[0])).toBe(`${process.cwd()}/config.schema.json`)
  })

  it('writes every page the schema declares, under the output directory', async () => {
    mockSchema(multiPage)

    const files = await generateDocs({ schemaPath: '/schemas/config.json', outDir: '/out/documentation' })

    expect(files.map((file) => file.filename)).toEqual(['configuration.md', 'configuration/typescript.md'])
    expect(written().map(([path]) => path)).toEqual([
      '/out/documentation/configuration.md',
      '/out/documentation/configuration/typescript.md',
    ])
    expect(written()[1]?.[1]).toContain('# TypeScript')
  })

  // A page in a subdirectory has to have that directory created first, and the
  // caller should not have to know which directories a schema will ask for.
  it('creates the directory of every page before writing it', async () => {
    mockSchema(multiPage)

    await generateDocs({ outDir: '/out' })

    expect(mkdirMock.mock.calls.map(([path]) => String(path))).toEqual(['/out', '/out/configuration'])
    expect(mkdirMock.mock.calls[0]?.[1]).toEqual({ recursive: true })
  })

  it('passes the caller options through to the renderer', async () => {
    mockSchema({ title: 'Config', properties: { a: { type: 'string', default: 'x' } } })

    const files = await generateDocs({ outDir: '/out', file: 'reference.md', language: 'javascript' })

    expect(files[0]?.filename).toBe('reference.md')
    expect(files[0]?.content).toContain("**Default:** `'x'`")
  })

  it('resolves a relative output directory against the working directory', async () => {
    mockSchema({ title: 'Config' })

    await generateDocs({ outDir: 'documentation' })

    expect(written()[0]?.[0]).toBe(`${process.cwd()}/documentation/index.md`)
  })

  // The filenames come from the schema, which makes them input. What refuses
  // them is the page model, before anything is written — these three tests
  // exercise that, not the `isInsideDirectory` check in `generateDocs`, which
  // nothing reaching it today can fail. What matters to a caller is the same
  // either way: the write does not happen.
  it('refuses a page that would be written outside the output directory', async () => {
    mockSchema({ 'x-doc': { file: '../../etc/passwd' } })

    await expect(generateDocs({ outDir: '/out' })).rejects.toThrow(/outside the output directory/)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('refuses an absolute page path', async () => {
    mockSchema({ 'x-doc': { file: '/etc/passwd' } })

    await expect(generateDocs({ outDir: '/out' })).rejects.toThrow(/outside the output directory/)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  // `../out/a.md` climbs out of the output directory and back into it, so it
  // resolves onto a file another page already owns — and the first page was
  // overwritten with no error.
  it('refuses a page that climbs out of the output directory and back in', async () => {
    mockSchema({
      'x-doc': {
        file: 'index.md',
        pages: [
          { id: 'one', file: 'a.md', title: 'One' },
          { id: 'two', file: '../out/a.md', title: 'Two' },
        ],
      },
      properties: {},
    })

    await expect(generateDocs({ outDir: '/out' })).rejects.toThrow(/outside the output directory/)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('refuses a page whose path names no file', async () => {
    mockSchema({ 'x-doc': { pages: [{ id: 'p', file: '.', title: 'P' }] }, properties: {} })

    await expect(generateDocs({ outDir: '/out' })).rejects.toThrow(/has no file to be written to/)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  // `JSON.parse` reports an offset and nothing else, which does not say which
  // file is malformed when a build documents several schemas at once.
  it('names the file in a JSON syntax error', async () => {
    readFileMock.mockImplementation(async () => '{ "title": ')

    await expect(generateDocs({ schemaPath: '/schemas/broken.json' })).rejects.toThrow(
      /\/schemas\/broken\.json is not valid JSON/,
    )
  })

  it('lets a read error through rather than writing an empty page', async () => {
    readFileMock.mockImplementation(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    await expect(generateDocs()).rejects.toThrow('ENOENT')
    expect(writeFileMock).not.toHaveBeenCalled()
  })
})
