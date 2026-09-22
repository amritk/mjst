export { dereferenceSchema } from '#helpers/dereference'
export { type GenerateDocsOptions, generateDocs } from '#reference/generate-docs'
export { generateMarkdownFiles } from '#reference/generate-markdown-files'
export { type GenerateConfigTableOptions, generateConfigTable } from '#table/generate-config-table'
export { generateMarkdown } from '#table/generate-markdown'
export { renderConfigTable } from '#table/render-config-table'
export type {
  DocConfig,
  DocExample,
  DocHeadings,
  DocHeadingType,
  DocLayout,
  DocMeta,
  DocPage,
  DocSection,
  DocSort,
  DocTable,
  DocTableColumn,
  DocTableRequired,
  GeneratedFile,
  MarkdownHeadingsOptions,
  MarkdownOptions,
  MarkdownTableOptions,
} from '#types/doc'
export type { ConfigSchema, SchemaProperty } from '#types/schema'
