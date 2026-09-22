/**
 * Everything an anchor drops. What survives is a letter, a number, a combining
 * mark, an underscore, a hyphen or a space — so the punctuation a property name
 * is full of (`foo.bar`, `$ref`, `on:push`) disappears rather than being
 * encoded, and so does every character the heading's own markup added.
 *
 * Unicode letters stay: a docs site keeps them in the id, and stripping them
 * would leave a Japanese heading with no anchor at all.
 */
const DROPPED = /[^\p{L}\p{N}\p{M}_\- ]/gu

/**
 * The anchor a docs site gives a heading — GitHub's rules, which the renderers
 * behind most docs sites copy: lowercase, drop the punctuation, and turn each
 * space into a hyphen.
 *
 * It takes the text a reader *sees*, not the markdown that produced it, which
 * is the only way `` `foo.bar` `` and `foo.bar` can agree: the backticks are
 * markup, so the heading renders as the same words either way and gets the same
 * anchor. Pair it with {@link propertyHeading}, which hands out both forms of a
 * heading from one place, and a change to how headings render moves the anchors
 * with it.
 *
 * One rule is deliberately missing: GitHub de-duplicates a repeated anchor by
 * appending `-1`, `-2`, and this does not. Knowing which occurrence a heading is
 * needs the page's whole heading list, in render order, and a table is rendered
 * before the headings it links to. So two properties with the same name on one
 * page — at different nesting levels, say — both link to the first of them.
 * That is a link to the wrong section of the right page, which is worth the
 * anchors on every other row.
 */
export const headingAnchor = (text: string): string => text.trim().toLowerCase().replace(DROPPED, '').replace(/ /g, '-')
