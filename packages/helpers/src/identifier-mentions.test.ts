import { describe, expect, it } from 'vitest'

import { identifierMentions } from './identifier-mentions'

describe('identifierMentions', () => {
  it('sees a name the code actually spells', () => {
    expect(identifierMentions('const a: Contact = parseContact(x)')('Contact')).toBe(true)
    expect(identifierMentions('const a: Contact = parseContact(x)')('parseContact')).toBe(true)
  })

  it('does not count a name that only appears in prose or data', () => {
    // Each of these carries schema text verbatim: a JSDoc block is the
    // `description`, a string literal is an error message or an `enum` member,
    // and a regex literal is a `pattern`.
    expect(identifierMentions('/** see Contact for details */\nconst a = 1')('Contact')).toBe(false)
    expect(identifierMentions('// Contact\nconst a = 1')('Contact')).toBe(false)
    expect(identifierMentions('const m = "Contact"')('Contact')).toBe(false)
    expect(identifierMentions("const m = 'Contact'")('Contact')).toBe(false)
    expect(identifierMentions('const r = /Contact/u')('Contact')).toBe(false)
  })

  it('is not fooled by a regex literal that opens what looks like a comment', () => {
    // A `pattern` of `^a/*b$` emits a regex whose first two characters are `/`
    // and `*`. Stripping comments with a plain replace read that as the start of
    // a block comment and blanked the rest of the file to the next terminator,
    // dropping the imports every call below it needs.
    const body = ['  if (!/^a\\/*b$/u.test(_v)) return false;', '  validateContact(input, _path)', '/** doc */'].join(
      '\n',
    )

    expect(identifierMentions(body)('validateContact')).toBe(true)
  })

  it('is not fooled by an apostrophe inside a regex literal', () => {
    // The media-range format check, which carries both an apostrophe and a
    // backtick inside its character class.
    const body = [
      "const ok = /^[0-9A-Za-z!#$%&'*+.^_`|~-]+$/u.test(v)",
      'validateContact(input)',
      "const s = 'a'",
    ].join('\n')

    expect(identifierMentions(body)('validateContact')).toBe(true)
  })

  it('reads a slash after a value as division rather than a regex', () => {
    expect(identifierMentions('const a = b / c; validateContact(x)')('validateContact')).toBe(true)
  })

  it('keeps every binding when a run never terminates', () => {
    // Keeping a binding nothing reads costs a lint error; dropping one the code
    // calls costs a build. An unparseable body takes the first.
    expect(identifierMentions('validateContact(x)\n/* never closed')('validateContact')).toBe(true)
    expect(identifierMentions('validateContact(x)\nconst s = "never closed')('validateContact')).toBe(true)
  })
})
