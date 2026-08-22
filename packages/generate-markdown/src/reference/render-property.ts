import { remainingParagraphs, trimDescription } from '#helpers/first-paragraph'
import { formatInlineLiteral } from '#helpers/format-literal'
import { asArray } from '#helpers/guards'
import { heading } from '#helpers/heading'
import { headingProse, headingText } from '#helpers/heading-text'
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

/** How a property is rendered when its surroundings already say part of it. */
export type RenderPropertyOptions = {
  /**
   * The property has a table row directly above it. Its type, requiredness and
   * default are in that row, so the block below carries only what a row cannot
   * hold: the examples, the notes, and the table of its own children.
   *
   * A block in that position always gets a heading, whatever `x-doc.heading`
   * says. `heading: false` means "the heading above already names this" — true
   * of a page or a section, and false of a table row, which names it in a cell
   * several lines up. Without one, a child's Deprecated callout read as the
   * parent's, and two heading-less children produced three tables in a row with
   * nothing to say which was whose.
   */
  readonly summarised?: boolean
}

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
export const renderProperty = (
  entry: DocEntry,
  level: number,
  context: RenderContext,
  options: RenderPropertyOptions = {},
): readonly string[] => {
  const { name, prop, path, required } = entry
  const meta = readDocMeta(prop)
  const blocks: string[] = []

  const titled = meta.heading || options.summarised === true
  // A title of whitespace is not a title: honouring it left an empty heading
  // where the property's name should be.
  const title = meta.title?.trim() === '' ? undefined : meta.title
  if (titled) blocks.push(heading(level, title === undefined ? headingText(name) : headingProse(title)))
  // Never inside the heading guard: `heading: false` drops the property's own
  // name and shape because the page or section above already carries them, and
  // neither of those says the property is on its way out.
  if (prop.deprecated === true) blocks.push('> **Deprecated**')
  // `summarised` means a table row directly above already states the shape, so
  // repeating it here would print the same three facts twice.
  if (meta.heading && !options.summarised) {
    const type = referenceType(prop, context.language)
    if (type.length > 0) blocks.push(`**Type:** ${code(type)}`)
    if (required) blocks.push('**Required**')
  }

  // Under a row, only the paragraph the row could hold is a restatement. The
  // rest of the description has appeared nowhere else, and dropping it lost
  // whole paragraphs of prose.
  const description = trimDescription(readDescription(prop))
  const prose = options.summarised ? remainingParagraphs(description) : description
  if (prose.length > 0) blocks.push(prose)

  // Same rule for the default: the Default column skips a `null`, so a `null`
  // default is the row's omission rather than its content.
  if (prop.default !== undefined && (!options.summarised || prop.default === null)) {
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
  // The first example is only spoken for when a derived block will print it. A
  // row suppresses that block, and slicing it off anyway meant the first
  // example appeared nowhere at all.
  const listed = derived === undefined || options.summarised ? examples : examples.slice(1)
  if (listed.length > 0) blocks.push(`**Examples:** ${codeList(listed, context.language)}`)

  const constraints = readConstraints(prop, context.language)
  if (constraints.length > 0) blocks.push(`**Constraints:** ${constraints.map(code).join(', ')}`)

  // Every line of a note has to carry the `>` marker, and CommonMark counts a
  // bare CR as a line ending: a note holding one escaped the blockquote and the
  // rest of it became page structure.
  for (const note of meta.notes) blocks.push(`> ${note.replace(/\r\n?/g, '\n').replace(/\n/g, '\n> ')}`)

  // A derived example is this package's convenience, not the author's content:
  // under a row it would give every leaf option in a table a heading and a
  // fence, which is the opposite of what a table layout was chosen for. An
  // example the author wrote is content, and stays.
  const shown = derived === undefined ? meta.examples : options.summarised ? [] : [derived]
  blocks.push(...renderExamples(shown, context.language))
  for (const footer of meta.footers) blocks.push(trimDescription(footer))

  const childLevelBase = titled ? level + 1 : level
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
      // Emitted whenever the child has anything the row could not carry — its
      // own children, but also a Deprecated callout, constraints, examples,
      // notes or the rest of its prose. Gating on children alone lost all of
      // those for every leaf option in a table.
      // Compared against the child's own heading, not against one: a child with
      // `heading: false` pushes none, so counting one dropped its whole block —
      // table and all.
      // Always labelled, so the gate is always "more than the heading".
      const sub = renderProperty(child, childLevelBase, context, { summarised: true })
      if (sub.length > 1) blocks.push(...sub)
    }
    return blocks
  }
  // With no heading of its own this property occupies its parent's level, so
  // its children stay where they would have been.
  for (const child of children) blocks.push(...renderProperty(child, childLevelBase, context))
  return blocks
}
