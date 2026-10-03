import { promoteBoldLabels } from '#reference/promote-bold-labels'
import { renderSteps } from '#reference/render-steps'
import type { RenderContext } from '#types/render'

/**
 * Renders a piece of prose printed in full — a description under a heading,
 * page and section prose, a note, a footer — with whatever the schema opted
 * into: bold labels promoted to headings at `level`, then lead-in lists turned
 * into steps.
 *
 * In that order, so the labels are found while every step body is still part
 * of its list item, and a list straight under a label still converts.
 */
export const renderProse = (markdown: string, level: number, context: RenderContext): string =>
  renderSteps(promoteBoldLabels(markdown, level, context), context)
