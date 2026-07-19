import { describe, expect, it } from 'vitest'

import { parseCompileApiArgs } from './parse-compile-api-args'

describe('parse-compile-api-args', () => {
  it('parses the positional and every flag', () => {
    const args = parseCompileApiArgs([
      'src/routes.ts',
      '--out',
      'dist/handler.js',
      '--routes-import',
      './routes',
      '--options',
      'options.json',
      '--open-api-path',
      '/docs.json',
      '--max-body-bytes',
      '2048',
    ])
    expect(args).toEqual({
      routesModule: 'src/routes.ts',
      out: 'dist/handler.js',
      routesImport: './routes',
      optionsFile: 'options.json',
      openApiPath: '/docs.json',
      maxBodyBytes: 2048,
    })
  })

  it('accepts --flag=value and camelCase spellings', () => {
    const args = parseCompileApiArgs(['routes.ts', '--out=dist/handler.js', '--routesImport=./r'])
    expect(args.out).toBe('dist/handler.js')
    expect(args.routesImport).toBe('./r')
  })

  it('parses Infinity for --max-body-bytes', () => {
    expect(parseCompileApiArgs(['r.ts', '--max-body-bytes', 'Infinity']).maxBodyBytes).toBe(Number.POSITIVE_INFINITY)
  })

  it('rejects a non-numeric --max-body-bytes', () => {
    expect(() => parseCompileApiArgs(['r.ts', '--max-body-bytes', 'lots'])).toThrow(/Invalid --max-body-bytes/)
  })

  it('rejects a flag without a value', () => {
    expect(() => parseCompileApiArgs(['r.ts', '--out'])).toThrow(/expects a value/)
  })

  it('rejects unknown flags', () => {
    expect(() => parseCompileApiArgs(['r.ts', '--nope', 'x'])).toThrow(/Unknown flag "--nope"/)
  })

  it('rejects a second positional', () => {
    expect(() => parseCompileApiArgs(['a.ts', 'b.ts'])).toThrow(/single routes module path/)
  })

  it('recognizes --help and -h', () => {
    expect(parseCompileApiArgs(['--help']).help).toBe(true)
    expect(parseCompileApiArgs(['-h']).help).toBe(true)
  })
})
