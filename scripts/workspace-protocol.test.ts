import { describe, expect, it } from 'vitest'

import { type PackageJson, resolveCatalog, resolveProtocols, resolveWorkspace } from './workspace-protocol'

describe('resolveWorkspace', () => {
  it('resolves the bare and star forms to a caret range, not an exact pin', () => {
    // Every inter-package edge in this repo uses `workspace:*`. Pinning them
    // exactly duplicates shared dependencies for a consumer who installs two
    // @amritk/* packages published at different times; a caret dedupes them.
    expect(resolveWorkspace('workspace:', '1.2.3')).toBe('^1.2.3')
    expect(resolveWorkspace('workspace:*', '1.2.3')).toBe('^1.2.3')
  })

  it('keeps pre-1.0 ranges narrow', () => {
    // ^0.14.0 is >=0.14.0 <0.15.0 — patch-wide only, and breaking changes here
    // ride a minor bump, so the caret cannot pull in an incompatible release.
    expect(resolveWorkspace('workspace:*', '0.14.0')).toBe('^0.14.0')
  })

  it('expands the bare caret/tilde forms against the workspace version', () => {
    expect(resolveWorkspace('workspace:^', '1.2.3')).toBe('^1.2.3')
    expect(resolveWorkspace('workspace:~', '1.2.3')).toBe('~1.2.3')
  })

  it('keeps an explicit range verbatim', () => {
    expect(resolveWorkspace('workspace:1.2.3', '9.9.9')).toBe('1.2.3')
    expect(resolveWorkspace('workspace:>=1.0.0 <2', '9.9.9')).toBe('>=1.0.0 <2')
  })
})

describe('resolveCatalog', () => {
  const root: PackageJson = {
    catalog: { 'json-schema-typed': '^8.0.1' },
    catalogs: { testing: { vitest: '^4.1.5' } },
  }

  it('reads the default catalog for the bare form', () => {
    expect(resolveCatalog('catalog:', 'json-schema-typed', root)).toBe('^8.0.1')
  })

  it('reads a named catalog', () => {
    expect(resolveCatalog('catalog:testing', 'vitest', root)).toBe('^4.1.5')
  })

  it('throws on a missing entry rather than shipping the specifier literally', () => {
    expect(() => resolveCatalog('catalog:', 'missing', root)).toThrow(/No catalog entry for "missing"/)
    expect(() => resolveCatalog('catalog:absent', 'vitest', root)).toThrow(/No catalog "absent" entry/)
  })
})

describe('resolveProtocols', () => {
  const root: PackageJson = { catalog: { 'json-schema-typed': '^8.0.1' } }

  it('rewrites every dependency field in place and reports the change', () => {
    const pkg: PackageJson = {
      name: '@amritk/mjst',
      dependencies: { '@amritk/helpers': 'workspace:*', 'json-schema-typed': 'catalog:', yargs: '^17.7.2' },
      devDependencies: { '@amritk/generate-markdown': 'workspace:*' },
      peerDependencies: { '@amritk/lint': 'workspace:^' },
    }
    const versions = new Map([
      ['@amritk/helpers', '0.14.0'],
      ['@amritk/generate-markdown', '0.4.5'],
      ['@amritk/lint', '0.4.3'],
    ])

    expect(resolveProtocols(pkg, versions, root)).toBe(true)
    expect(pkg.dependencies).toEqual({
      '@amritk/helpers': '^0.14.0',
      'json-schema-typed': '^8.0.1',
      yargs: '^17.7.2',
    })
    expect(pkg.devDependencies).toEqual({ '@amritk/generate-markdown': '^0.4.5' })
    expect(pkg.peerDependencies).toEqual({ '@amritk/lint': '^0.4.3' })
  })

  it('leaves a manifest without protocol specifiers untouched', () => {
    const pkg: PackageJson = { name: '@amritk/yaml', dependencies: { yargs: '^17.7.2' } }
    expect(resolveProtocols(pkg, new Map(), root)).toBe(false)
  })

  it('throws when a workspace dependency has no known version', () => {
    const pkg: PackageJson = { name: '@amritk/mjst', dependencies: { '@amritk/ghost': 'workspace:*' } }
    expect(() => resolveProtocols(pkg, new Map(), root)).toThrow(/No workspace version found for "@amritk\/ghost"/)
  })
})
