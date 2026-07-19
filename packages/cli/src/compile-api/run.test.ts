import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { run } from './run'

// A minimal routes module: two genuine contracts plus exports that must be
// ignored (a schema-ish object and a function), written as .mjs so the test
// runtime can import it without a TypeScript loader.
const ROUTES_MODULE = [
  'export const health = {',
  "  method: 'get',",
  "  path: '/health',",
  "  responses: { 200: { body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } },",
  '  handler: () => ({ status: 200, body: { ok: true } }),',
  '}',
  'export const getUser = {',
  "  method: 'get',",
  "  path: '/users/{id}',",
  "  request: { params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },",
  "  responses: { 200: { body: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },",
  '  handler: (c) => ({ status: 200, body: { id: c.params.id } }),',
  '}',
  "export const userSchema = { type: 'object' }",
  'export const makeContext = () => ({})',
].join('\n')

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

const writeRoutes = (dir: string, name = 'routes.mjs'): string => {
  const path = join(dir, name)
  writeFileSync(path, ROUTES_MODULE)
  return path
}

describe('run', () => {
  it('compiles a routes module to a fetch-handler module', async () => {
    const dir = tmp('compile-api-')
    const routes = writeRoutes(dir)
    const out = join(dir, 'handler.js')
    const { code, stdout, stderr } = await run([routes, '--out', out])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('health')
    expect(stdout).toContain('getUser')
    const content = readFileSync(out, 'utf-8')
    // The generated module imports the contracts back and default-exports the
    // fused fetch handler.
    expect(content).toContain('from "./routes.mjs"')
    expect(content).toContain('export default { fetch }')
    expect(content).toContain('getUser')
    // The non-contract exports never became routes.
    expect(content).not.toContain('userSchema')
  })

  it('defaults the routes import to a relative specifier from the out file', async () => {
    const dir = tmp('compile-api-rel-')
    const routes = writeRoutes(dir)
    const out = join(dir, 'dist', 'nested', 'handler.js')
    const { code } = await run([routes, '--out', out])
    expect(code).toBe(0)
    // Parent directories were created and the specifier climbs back out of them.
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out, 'utf-8')).toContain('from "../../routes.mjs"')
  })

  it('honors --routes-import over the derived default', async () => {
    const dir = tmp('compile-api-imp-')
    const routes = writeRoutes(dir)
    const out = join(dir, 'handler.js')
    const { code } = await run([routes, '--out', out, '--routes-import', '#app/routes'])
    expect(code).toBe(0)
    expect(readFileSync(out, 'utf-8')).toContain('from "#app/routes"')
  })

  it('spreads --options JSON into the compile options', async () => {
    const dir = tmp('compile-api-opt-')
    const routes = writeRoutes(dir)
    const optionsFile = join(dir, 'compile-options.json')
    writeFileSync(optionsFile, JSON.stringify({ info: { title: 'My Service', version: '2.0.0' } }))
    const out = join(dir, 'handler.js')
    const { code } = await run([routes, '--out', out, '--options', optionsFile])
    expect(code).toBe(0)
    // The info block lands in the precomputed OpenAPI document string.
    const content = readFileSync(out, 'utf-8')
    expect(content).toContain('My Service')
    expect(content).toContain('2.0.0')
  })

  it('lets flags win over the --options file', async () => {
    const dir = tmp('compile-api-prec-')
    const routes = writeRoutes(dir)
    const optionsFile = join(dir, 'compile-options.json')
    writeFileSync(optionsFile, JSON.stringify({ openApiPath: '/from-file.json' }))
    const out = join(dir, 'handler.js')
    const { code } = await run([routes, '--out', out, '--options', optionsFile, '--open-api-path', '/from-flag.json'])
    expect(code).toBe(0)
    const content = readFileSync(out, 'utf-8')
    expect(content).toContain('/from-flag.json')
    expect(content).not.toContain('/from-file.json')
  })

  it('accepts --open-api-path and --max-body-bytes', async () => {
    const dir = tmp('compile-api-flags-')
    const routes = writeRoutes(dir)
    const out = join(dir, 'handler.js')
    const { code } = await run([routes, '--out', out, '--open-api-path', '/docs.json', '--max-body-bytes', '2048'])
    expect(code).toBe(0)
    expect(readFileSync(out, 'utf-8')).toContain('/docs.json')
  })

  it('exits 2 without --out', async () => {
    const dir = tmp('compile-api-noout-')
    const routes = writeRoutes(dir)
    const { code, stderr } = await run([routes])
    expect(code).toBe(2)
    expect(stderr).toContain('--out is required')
  })

  it('exits 2 without a routes module path', async () => {
    const { code, stderr } = await run(['--out', join(tmp('compile-api-nomod-'), 'handler.js')])
    expect(code).toBe(2)
    expect(stderr).toContain('routes module path is required')
  })

  it('exits 2 on an unknown flag', async () => {
    const { code, stderr } = await run(['routes.mjs', '--out', 'handler.js', '--nope'])
    expect(code).toBe(2)
    expect(stderr).toContain('Unknown flag "--nope"')
  })

  it('exits 1 when the routes module cannot be loaded', async () => {
    const dir = tmp('compile-api-missing-')
    const { code, stderr } = await run([join(dir, 'does-not-exist.mjs'), '--out', join(dir, 'handler.js')])
    expect(code).toBe(1)
    expect(stderr).toContain('Failed to load routes module')
  })

  it('exits 1 when the module exports no route contracts', async () => {
    const dir = tmp('compile-api-none-')
    const path = join(dir, 'not-routes.mjs')
    writeFileSync(path, "export const config = { port: 3000 }\nexport default { method: 'get' }")
    const { code, stderr } = await run([path, '--out', join(dir, 'handler.js')])
    expect(code).toBe(1)
    expect(stderr).toContain('No route contracts found')
  })

  it('exits 1 for an invalid --options file', async () => {
    const dir = tmp('compile-api-badopt-')
    const routes = writeRoutes(dir)
    const optionsFile = join(dir, 'broken.json')
    writeFileSync(optionsFile, '{ not json')
    const { code, stderr } = await run([routes, '--out', join(dir, 'handler.js'), '--options', optionsFile])
    expect(code).toBe(1)
    expect(stderr).toContain('Invalid JSON in --options file')
  })

  it('exits 1 when compileToModule rejects the options', async () => {
    const dir = tmp('compile-api-badmount-')
    const routes = writeRoutes(dir)
    const optionsFile = join(dir, 'compile-options.json')
    // A mount prefix without a leading slash is rejected by compileToModule.
    writeFileSync(optionsFile, JSON.stringify({ mounts: { auth: 'authHandler' } }))
    const { code, stderr } = await run([routes, '--out', join(dir, 'handler.js'), '--options', optionsFile])
    expect(code).toBe(1)
    expect(stderr).toContain('Mount prefix')
  })

  it('prints its own help with --help', async () => {
    const { code, stdout } = await run(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('mjst compile-api <routes-module> --out <file>')
  })
})
