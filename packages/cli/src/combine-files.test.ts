import type { GeneratedFile } from '@amritk/generate-parsers'
import { describe, expect, it } from 'vitest'

import { combineGeneratedFiles } from './combine-files'

describe('combineGeneratedFiles', () => {
  it('drops relative imports and the index barrel, inlining every definition', () => {
    const files: GeneratedFile[] = [
      {
        filename: 'document.ts',
        content: "import type { Person } from './person';\n\nexport type Document = {\n  owner?: Person;\n};",
      },
      {
        filename: 'person.ts',
        content: 'export type Person = {\n  name: string;\n};',
      },
      {
        filename: 'index.ts',
        content: "export type { Document } from './document';\nexport type { Person } from './person';\n",
      },
    ]

    const result = combineGeneratedFiles(files)

    expect(result).not.toContain('import')
    expect(result).not.toContain('./document')
    expect(result).toContain('export type Document =')
    expect(result).toContain('export type Person =')
  })

  it('hoists and deduplicates external (non-relative) imports', () => {
    const files: GeneratedFile[] = [
      {
        filename: 'a.ts',
        content: "import { isObject } from '@amritk/helpers/is-object';\n\nexport const a = isObject;",
      },
      {
        filename: 'b.ts',
        content: "import { isObject } from '@amritk/helpers/is-object';\n\nexport const b = isObject;",
      },
    ]

    const result = combineGeneratedFiles(files)
    const importCount = result.split('\n').filter((line) => line.startsWith('import')).length

    expect(importCount).toBe(1)
    expect(result).toContain("import { isObject } from '@amritk/helpers/is-object';")
  })
})
