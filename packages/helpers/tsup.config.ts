import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/build-dynamic-ref-map.ts',
    'src/extract-refs.ts',
    'src/generate-type-definition.ts',
    'src/is-object.ts',
    'src/parse-documentation.ts',
    'src/ref-to-filename.ts',
    'src/ref-to-name.ts',
    'src/resolve-dynamic-refs.ts',
    'src/resolve-ref.ts',
    'src/safe-accessor.ts',
    'src/schema-guards.ts',
    'src/upgrade-draft07-schema.ts',
    'src/validate-array.ts',
    'src/validate-record.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  target: 'node20',
  splitting: true,
})
