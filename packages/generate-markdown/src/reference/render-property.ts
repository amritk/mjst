import { formatInlineLiteral } from '#helpers/format-literal'
import { asArray } from '#helpers/guards'
import { heading } from '#helpers/heading'
import { headingText } from '#helpers/heading-text'
import { inlineCode } from '#helpers/inline-code'
import { readConstraints } from '#helpers/read-constraints'
import { readDescription, readDocMeta } from '#helpers/read-doc-meta'
import { referenceType, typeShowsEnum } from '#helpers/reference-type'
import { childEntries } from '#reference/child-entries'
import { deriveExample } from '#reference/derive-example'
import { renderExamples } from '#reference/render-examples'
import { renderPropertyTable } from '#reference/render-property-table'
import type { DocEntry, RenderContext } from '#types/render'

/**
 * Wraps a value in a code span for the metadata lines above the prose. Every
 * one of these values is schema-controlled, so the span has to survive a
 * backtick or a line ending inside it — see {@link inlineCode}.
 */
const code = (value: string): string => inlineCode(value)

/**
 * True when the property is rendered somewhere other than under its parent —
 * on another page, or in a section of its own further down this one.
 */
const documentedElsewhere = (entry: DocEntry, context: RenderContext): boolean => {
  const meta = readDocMeta(entry.prop)
  if (meta.section !== undefined) return true
  return meta.page !== undefined && meta.page !== context.page
}

/** Comma-separated code spans, for the allowed-values and examples lines. */
const codeList = (values: readonly unknown[], language: string): string =>
  values.map((value) => code(formatInlineLiteral(value, language))).join(', ')

/**
 * Renders one property as a heading and the blocks beneath it — the prose style
 * a hand-written configuration reference uses, rather than a table row.
 *
 * The block order is deliberate and stays the same for every property, so the
 * page reads as a reference and not as a pile of schema keywords:
 *
 * 1. the heading, then a **Deprecated** callout when the schema says so,
 * 2. the **Type:** label and a **Required** marker — what the reader needs
 *    before the prose can mean anything,
 * 3. the description, verbatim markdown, so a schema can carry lists and links,
 * 4. **Default:**, **Allowed values:**, **Examples:** and **Constraints:** —
 *    the facts the prose should not have to repeat,
 * 5. any notes as blockquotes, the code examples, the `x-doc.footer` prose
 *    that only makes sense after them, and finally the children.
 *
 * Returns blocks rather than one string so the caller controls the blank lines
 * between them (and can splice in its own).
 */
export const renderProperty = (entry: DocEntry, level: number, context: RenderContext): readonly string[] => {
  const { name, prop, path, required } = entry
  const meta = readDocMeta(prop)
  const blocks: string[] = []

  if (meta.heading) blocks.push(heading(level, headingText(meta.title ?? name)))
  // Never inside the heading guard: `heading: false` drops the property's own
  // name and shape because the page or section above already carries them, and
  // neither of those says the property is on its way out.
  if (prop.deprecated === true) blocks.push('> **Deprecated**')
  if (meta.heading) {
    const type = referenceType(prop, context.language)
    if (type.length > 0) blocks.push(`**Type:** ${code(type)}`)
    if (required) blocks.push('**Required**')
  }

  const description = readDescription(prop).trim()
  if (description.length > 0) blocks.push(description)

  if (prop.default !== undefined) {
    blocks.push(`**Default:** ${code(formatInlineLiteral(prop.default, context.language))}`)
  }

  const values = asArray(prop.enum)
  // The type label already spells out an enum, so repeating it here would be
  // the same sentence twice — unless `x-doc.type` replaced the label, or there
  // is no label at all because this property renders without a heading.
  if (values.length > 0 && (!meta.heading || !typeShowsEnum(prop))) {
    blocks.push(`**Allowed values:** ${codeList(values, context.language)}`)
  }

  const examples = asArray(prop.examples)
  const derived = meta.examples.length === 0 ? deriveExample(prop, path) : undefined
  // Whatever the derived block already showed is not listed again: the reader
  // sees the first example as pasteable config, and the alternatives inline.
  const listed = derived === undefined ? examples : examples.slice(1)
  if (listed.length > 0) blocks.push(`**Examples:** ${codeList(listed, context.language)}`)

  const constraints = readConstraints(prop, context.language)
  if (constraints.length > 0) blocks.push(`**Constraints:** ${constraints.map(code).join(', ')}`)

  for (const note of meta.notes) blocks.push(`> ${note.replace(/\n/g, '\n> ')}`)

  blocks.push(...renderExamples(derived === undefined ? meta.examples : [derived], context.language))
  for (const footer of meta.footers) blocks.push(footer.trim())

  const layout = meta.layout ?? context.layout
  if (layout === 'none') return blocks

  // A child that claims a page or a section of its own is documented there, not
  // here. In a table it still gets a row — the reader should see every option in
  // one place, with the row linking across when the page differs — but inlining
  // it under this heading would document it twice.
  const all = childEntries(prop, path, meta.sort ?? context.sort)
  const children = layout === 'table' ? all : all.filter((child) => !documentedElsewhere(child, context))
  if (children.length === 0) return blocks

  if (layout === 'table') {
    blocks.push(renderPropertyTable(children, context))
    // A table row says a child is an object; it cannot say what is in it. Any
    // child with a shape of its own gets its own table below, or a whole
    // subtree would be documented as the word `object` and nothing else.
    for (const child of children) {
      if (documentedElsewhere(child, context)) continue
      if (childEntries(child.prop, child.path, meta.sort ?? context.sort).length === 0) continue
      blocks.push(...renderProperty(child, level + (meta.heading ? 1 : 0), context))
    }
    return blocks
  }
  // With no heading of its own this property occupies its parent's level, so
  // its children stay where they would have been.
  const childLevel = meta.heading ? level + 1 : level
  for (const child of children) blocks.push(...renderProperty(child, childLevel, context))
  return blocks
}
