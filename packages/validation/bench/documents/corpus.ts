import { readdirSync, readFileSync } from 'node:fs'

// Relative, not `@amritk/yaml`: this package does not depend on the YAML parser,
// and bench code is unpublished dev tooling that may reach across packages.
import { parse } from '../../../yaml/src/index.ts'

const FIXTURES = new URL('../../../../fixtures/openapi/', import.meta.url)

type Document = { openapi: string; info: unknown; paths: Record<string, unknown> } & Record<string, unknown>

const load = (path: string): Document => {
  const text = readFileSync(new URL(path, FIXTURES), 'utf8')
  return (path.endsWith('.json') ? JSON.parse(text) : parse(text)) as Document
}

/**
 * Every vendored OpenAPI 3.0 document that is valid against the 3.0 schema.
 * DigitalOcean's is left out: its operations are `$ref`s to external files,
 * which 3.0 does not allow there, and the cases measure the already-valid path.
 */
const documents = (): Document[] => [
  ...readdirSync(new URL('v3.0/', FIXTURES))
    .sort()
    .map((file) => load(`v3.0/${file}`)),
  load('real-world/swagger-petstore.json'),
]

/**
 * Many small documents: each vendored 3.0 document whole, then each of its
 * paths, operations and component schemas as a document of its own — the
 * shape of a service checking one small config or spec fragment per call.
 */
export const smallCorpus = (): Document[] => {
  const out: Document[] = []
  for (const document of documents()) {
    const { openapi, info } = document
    out.push(document)
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      out.push({ openapi, info, paths: { [path]: item } })
      // And each operation on its own path item.
      for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
        out.push({ openapi, info, paths: { [path]: { [method]: operation } } })
      }
    }
    const components = (document['components'] as { schemas?: Record<string, unknown> } | undefined)?.schemas
    for (const [name, schema] of Object.entries(components ?? {})) {
      out.push({ openapi, info, paths: {}, components: { schemas: { [name]: schema } } })
    }
  }
  return out
}

/**
 * One large document: the vendored 3.0 documents' paths and components
 * repeated under fresh names until the JSON passes `targetBytes`.
 */
export const largeDocument = (targetBytes = 4 * 1024 * 1024): Document => {
  const sources = documents()
  const paths: Record<string, unknown> = {}
  const schemas: Record<string, unknown> = {}
  let size = 0
  for (let copy = 0; size < targetBytes; copy++) {
    for (const [index, source] of sources.entries()) {
      for (const [path, item] of Object.entries(source.paths ?? {})) {
        paths[`/c${copy}/d${index}${path}`] = item
        size += JSON.stringify(item).length
      }
      const components = (source['components'] as { schemas?: Record<string, unknown> } | undefined)?.schemas
      for (const [name, schema] of Object.entries(components ?? {})) {
        schemas[`${name}_${copy}_${index}`] = schema
        size += JSON.stringify(schema).length
      }
    }
  }
  return { openapi: '3.0.3', info: { title: 'Large', version: '1' }, paths, components: { schemas } }
}
